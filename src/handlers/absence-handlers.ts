import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { PersonioClient } from '../api/personio-client.js';
import { isValidAbsenceArgs, isValidBalanceArgs, isValidReportArgs } from '../validators/index.js';
import { paginateStyleA } from '../utils/pagination.js';

// Advertised bounds for get_absences (mirrors inputSchema).
const ABSENCES_BOUNDS = { defaultLimit: 200, maxLimit: 200 };

export class AbsenceHandlers {
  constructor(private personioClient: PersonioClient) {}

  async handleGetAbsences(args: any) {
    if (!isValidAbsenceArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid absence arguments');
    }

    // No client-side filter: forward offset/limit and let Personio paginate
    // server-side (it honors them). `paginateStyleA` only defensively clamps
    // `limit` — it never re-applies `offset` (that was the double-application bug).
    const response = await this.personioClient.getAbsences({
      start_date: args?.start_date,
      end_date: args?.end_date,
      employees: args?.employee_ids,
      limit: args?.limit,
      offset: args?.offset,
    });

    const serverPage = response.data.map(abs =>
      this.personioClient.formatAbsenceData(abs)
    );

    const { items: formattedAbsences, offset, limit, total } = paginateStyleA(
      serverPage,
      { offset: args?.offset, limit: args?.limit },
      ABSENCES_BOUNDS,
      { mode: 'server', total: response.metadata?.total_elements ?? serverPage.length }
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            absences: formattedAbsences,
            count: formattedAbsences.length,
            total,
            offset,
            limit,
            filters: {
              start_date: args?.start_date,
              end_date: args?.end_date,
              employee_ids: args?.employee_ids,
            },
          }, null, 2),
        },
      ],
    };
  }

  async handleGetEmployeeAbsenceBalance(args: any) {
    if (!isValidBalanceArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid balance arguments');
    }

    const response = await this.personioClient.getAbsenceBalance(args.employee_id);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            employee_id: args.employee_id,
            balances: response.data,
          }, null, 2),
        },
      ],
    };
  }

  async handleGetAbsenceTypes(args: any) {
    const response = await this.personioClient.getAbsenceTypes();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            absence_types: response.data,
          }, null, 2),
        },
      ],
    };
  }

  async handleGetTeamAbsenceOverview(args: any) {
    const startDate = args?.start_date || new Date().toISOString().split('T')[0];
    const endDate = args?.end_date || startDate;

    const response = await this.personioClient.getAbsences({
      start_date: startDate,
      end_date: endDate,
    });

    const formattedAbsences = response.data.map(abs => 
      this.personioClient.formatAbsenceData(abs)
    );

    // Group by type and status
    const summary = {
      total_absences: formattedAbsences.length,
      by_type: {} as Record<string, number>,
      by_status: {} as Record<string, number>,
      employees_out: formattedAbsences.map(abs => ({
        employee_id: abs.employee_id,
        type: abs.type,
        status: abs.status,
        start_date: abs.start_date,
        end_date: abs.end_date,
      })),
    };

    formattedAbsences.forEach(abs => {
      summary.by_type[abs.type] = (summary.by_type[abs.type] || 0) + 1;
      summary.by_status[abs.status] = (summary.by_status[abs.status] || 0) + 1;
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            date_range: { start_date: startDate, end_date: endDate },
            summary,
          }, null, 2),
        },
      ],
    };
  }

  async handleGetAbsenceStatistics(args: any) {
    if (!isValidReportArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid statistics arguments');
    }

    const [absenceResponse, employeesResponse] = await Promise.all([
      this.personioClient.getAbsences({
        start_date: args.start_date,
        end_date: args.end_date,
      }),
      this.personioClient.getEmployees(),
    ]);

    const absences = absenceResponse.data.map(abs => 
      this.personioClient.formatAbsenceData(abs)
    );
    
    let employees = employeesResponse.data.map(emp => 
      this.personioClient.formatEmployeeData(emp)
    );

    // Filter by department if specified
    if (args.department) {
      employees = employees.filter(emp => 
        emp.department?.toLowerCase().includes(args.department?.toLowerCase() || '')
      );
      
      const employeeIds = new Set(employees.map(emp => emp.id));
      const filteredAbsences = absences.filter(abs => employeeIds.has(abs.employee_id));
      absences.length = 0;
      absences.push(...filteredAbsences);
    }

    // Calculate statistics
    const stats = {
      total_absences: absences.length,
      total_days: absences.reduce((sum, abs) => sum + abs.days_count, 0),
      by_type: {} as Record<string, { count: number; days: number }>,
      by_status: {} as Record<string, number>,
      by_month: {} as Record<string, number>,
      average_days_per_absence: 0,
      most_common_type: '',
    };

    absences.forEach(abs => {
      // By type
      if (!stats.by_type[abs.type]) {
        stats.by_type[abs.type] = { count: 0, days: 0 };
      }
      stats.by_type[abs.type].count++;
      stats.by_type[abs.type].days += abs.days_count;

      // By status
      stats.by_status[abs.status] = (stats.by_status[abs.status] || 0) + 1;

      // By month
      const month = abs.start_date.substring(0, 7); // YYYY-MM
      stats.by_month[month] = (stats.by_month[month] || 0) + 1;
    });

    stats.average_days_per_absence = absences.length > 0 ? stats.total_days / absences.length : 0;
    
    // Find most common type
    let maxCount = 0;
    Object.entries(stats.by_type).forEach(([type, data]) => {
      if (data.count > maxCount) {
        maxCount = data.count;
        stats.most_common_type = type;
      }
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            report_type: 'absence_statistics',
            date_range: { start_date: args.start_date, end_date: args.end_date },
            department_filter: args.department,
            statistics: stats,
          }, null, 2),
        },
      ],
    };
  }
}
