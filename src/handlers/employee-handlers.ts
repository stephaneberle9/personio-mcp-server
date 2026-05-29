import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { PersonioClient } from '../api/personio-client.js';
import { isValidEmployeeArgs, isValidEmployeesArgs, isValidSearchArgs } from '../validators/index.js';
import { employeesToCsv, formatCsvExport } from '../utils/export-helpers.js';

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

    const response = await this.personioClient.getEmployees({
      limit: args?.limit || 200,
      offset: args?.offset || 0,
      attributes,
      office: args?.office,
    });

    const formattedEmployees = response.data.map(emp =>
      this.personioClient.formatEmployeeData(emp)
    );

    // Handle CSV export format
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
            total: response.metadata?.total_elements || formattedEmployees.length,
            page: response.metadata?.current_page || 1,
          }, null, 2),
        },
      ],
    };
  }

  async handleSearchEmployees(args: any) {
    if (!isValidSearchArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid search arguments');
    }

    const response = await this.personioClient.getEmployees({
      limit: args.limit || 50,
    });

    const query = args.query.toLowerCase();
    const filteredEmployees = response.data
      .map(emp => this.personioClient.formatEmployeeData(emp))
      .filter(emp => 
        emp.name?.toLowerCase().includes(query) ||
        emp.email?.toLowerCase().includes(query) ||
        emp.department?.toLowerCase().includes(query) ||
        emp.position?.toLowerCase().includes(query)
      );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query: args.query,
            results: filteredEmployees,
            count: filteredEmployees.length,
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
