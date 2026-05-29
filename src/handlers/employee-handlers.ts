import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { PersonioClient } from '../api/personio-client.js';
import { isValidEmployeeArgs, isValidEmployeesArgs, isValidSearchArgs } from '../validators/index.js';
import { employeesToCsv, formatCsvExport } from '../utils/export-helpers.js';
import { applyOffsetLimit, paginateStyleA } from '../utils/pagination.js';

// Advertised bounds for list_employees (mirrors tool-definitions inputSchema).
const LIST_EMPLOYEES_BOUNDS = { defaultLimit: 200, maxLimit: 200 };
// Advertised bounds for search_employees results (mirrors inputSchema).
const SEARCH_EMPLOYEES_BOUNDS = { defaultLimit: 50, maxLimit: 200 };

export class EmployeeHandlers {
  constructor(private personioClient: PersonioClient) {}

  async handleGetEmployee(args: any) {
    if (!isValidEmployeeArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid employee arguments');
    }

    // Accept either raw Personio keys or resolved output names in `attributes`,
    // translating the latter back to the raw keys the API filter expects. Seed
    // the (cached) schema from this same employee so the get path needs no
    // employee-list scope.
    let attributes = args.attributes;
    if (attributes?.length) {
      await this.personioClient.getAttributeSchema(args.employee_id);
      attributes = await this.personioClient.resolveRequestedAttributes(attributes);
    }

    const response = await this.personioClient.getEmployee(args.employee_id, attributes);
    const formattedEmployee = this.personioClient.formatEmployeeData(response.data);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(formattedEmployee, null, 2),
        },
      ],
    };
  }

  async handleListEmployees(args: any) {
    if (!isValidEmployeesArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid employees list arguments');
    }

    // Accept either raw Personio keys or resolved output names in `attributes`.
    const attributes = await this.personioClient.resolveRequestedAttributes(args?.attributes);

    // Apply pagination EXACTLY ONCE, branching on whether a client-side filter
    // (office) is in play:
    //   * UNFILTERED → forward offset/limit and let Personio paginate server-side
    //     (it honors them); `paginateStyleA` only defensively clamps `limit`.
    //   * FILTERED   → fetch the COMPLETE set, filter by office, then slice once.
    const paginateParams = { offset: args?.offset, limit: args?.limit };
    let page;
    if (args?.office) {
      const response = await this.personioClient.getAllEmployees({ attributes, office: args.office });
      const allFormatted = response.data.map(emp => this.personioClient.formatEmployeeData(emp));
      page = paginateStyleA(allFormatted, paginateParams, LIST_EMPLOYEES_BOUNDS, { mode: 'client' });
    } else {
      const response = await this.personioClient.getEmployees({
        limit: args?.limit,
        offset: args?.offset,
        attributes,
      });
      const serverPage = response.data.map(emp => this.personioClient.formatEmployeeData(emp));
      page = paginateStyleA(serverPage, paginateParams, LIST_EMPLOYEES_BOUNDS, {
        mode: 'server',
        total: response.metadata?.total_elements ?? serverPage.length,
      });
    }
    const { items: formattedEmployees, offset, limit, total } = page;

    // Handle CSV export format (same sliced set as the JSON path).
    if (args?.format === 'csv') {
      const csv = employeesToCsv(formattedEmployees);
      const csvWithMetadata = formatCsvExport(csv, formattedEmployees.length);

      return {
        content: [
          {
            type: 'text',
            text: csvWithMetadata,
          },
        ],
      };
    }

    // Default JSON format
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            employees: formattedEmployees,
            count: formattedEmployees.length,
            total,
            offset,
            limit,
          }, null, 2),
        },
      ],
    };
  }

  async handleSearchEmployees(args: any) {
    if (!isValidSearchArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid search arguments');
    }

    // `limit` for search caps the number of RETURNED RESULTS, not the number of
    // employees scanned. The query must run across the FULL employee set —
    // otherwise matches beyond the first page are silently missed (this only
    // ever "worked" because the v1 endpoint ignored getEmployees' limit). Fetch
    // every employee, filter, THEN slice the filtered results.
    const response = await this.personioClient.getAllEmployees();

    const query = args.query.toLowerCase();
    const matches = response.data
      .map(emp => this.personioClient.formatEmployeeData(emp))
      .filter(emp =>
        emp.name?.toLowerCase().includes(query) ||
        emp.email?.toLowerCase().includes(query) ||
        emp.department?.toLowerCase().includes(query) ||
        emp.position?.toLowerCase().includes(query)
      );

    const { items: results, offset, limit } = applyOffsetLimit(
      matches,
      { offset: args?.offset, limit: args.limit },
      SEARCH_EMPLOYEES_BOUNDS
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query: args.query,
            results,
            count: results.length,
            // Total matches before slicing, so callers know more pages exist.
            total: matches.length,
            offset,
            limit,
          }, null, 2),
        },
      ],
    };
  }

  async handleListEmployeeAttributes(args: any) {
    // employee_id is optional: labels are tenant-global, so any employee's
    // attribute set describes the schema. Sample a specific one if asked.
    const employeeId =
      typeof args?.employee_id === 'number' ? args.employee_id : undefined;

    const attributes = await this.personioClient.getAttributeSchema(employeeId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            attributes,
            count: attributes.length,
            usage:
              'Request fields via the `attributes` parameter of get_employee / ' +
              'list_employees using either `key` or `output_key`. Values are ' +
              'returned under `output_key`.',
          }, null, 2),
        },
      ],
    };
  }
}
