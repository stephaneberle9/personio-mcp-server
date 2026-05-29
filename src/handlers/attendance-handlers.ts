import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { PersonioClient } from '../api/personio-client.js';
import { isValidAttendanceArgs, isValidReportArgs } from '../validators/index.js';
import { paginateStyleA } from '../utils/pagination.js';

// Advertised bounds for get_attendance_records (mirrors inputSchema).
const ATTENDANCE_RECORDS_BOUNDS = { defaultLimit: 200, maxLimit: 200 };

export class AttendanceHandlers {
  constructor(private personioClient: PersonioClient) {}

  async handleGetAttendanceRecords(args: any) {
    if (!isValidAttendanceArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid attendance arguments');
    }

    // No client-side filter: forward offset/limit and let Personio paginate
    // server-side (it honors them). `paginateStyleA` only defensively clamps
    // `limit` — it never re-applies `offset` (that was the double-application bug).
    const response = await this.personioClient.getAttendances({
      start_date: args?.start_date,
      end_date: args?.end_date,
      employees: args?.employee_ids,
      limit: args?.limit,
      offset: args?.offset,
    });

    const serverPage = response.data.map(att =>
      this.personioClient.formatAttendanceData(att)
    );

    const { items: formattedAttendances, offset, limit, total } = paginateStyleA(
      serverPage,
      { offset: args?.offset, limit: args?.limit },
      ATTENDANCE_RECORDS_BOUNDS,
      { mode: 'server', total: response.metadata?.total_elements ?? serverPage.length }
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            attendance_records: formattedAttendances,
            count: formattedAttendances.length,
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

  async handleGetCurrentAttendanceStatus(args: any) {
    const today = new Date().toISOString().split('T')[0];
    
    const response = await this.personioClient.getAttendances({
      start_date: today,
      end_date: today,
      employees: args?.employee_ids,
    });

    const formattedAttendances = response.data.map(att => 
      this.personioClient.formatAttendanceData(att)
    );

    // Group by employee and determine current status
    const statusMap = new Map();
    formattedAttendances.forEach(att => {
      const existing = statusMap.get(att.employee_id);
      if (!existing || att.start_time > existing.start_time) {
        statusMap.set(att.employee_id, {
          ...att,
          status: att.end_time ? 'checked_out' : 'checked_in',
        });
      }
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            date: today,
            current_status: Array.from(statusMap.values()),
            summary: {
              checked_in: Array.from(statusMap.values()).filter(s => s.status === 'checked_in').length,
              checked_out: Array.from(statusMap.values()).filter(s => s.status === 'checked_out').length,
            },
          }, null, 2),
        },
      ],
    };
  }

  async handleGenerateAttendanceReport(args: any) {
    if (!isValidReportArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid report arguments');
    }

    const [attendanceResponse, employeesResponse] = await Promise.all([
      this.personioClient.getAttendances({
        start_date: args.start_date,
        end_date: args.end_date,
        employees: args.employee_ids,
      }),
      this.personioClient.getEmployees(),
    ]);

    const attendances = attendanceResponse.data.map(att => 
      this.personioClient.formatAttendanceData(att)
    );
    
    const employees = employeesResponse.data.map(emp => 
      this.personioClient.formatEmployeeData(emp)
    );

    // Filter by department if specified
    const filteredEmployees = args.department 
      ? employees.filter(emp => emp.department?.toLowerCase().includes(args.department?.toLowerCase() || ''))
      : employees;

    // Calculate statistics
    const stats = {
      total_records: attendances.length,
      unique_employees: new Set(attendances.map(a => a.employee_id)).size,
      date_range: { start_date: args.start_date, end_date: args.end_date },
      department_filter: args.department,
      average_hours_per_day: 0,
      total_break_time: 0,
    };

    // Calculate average hours and break time
    let totalHours = 0;
    let totalBreaks = 0;
    let validRecords = 0;

    attendances.forEach(att => {
      if (att.start_time && att.end_time) {
        const start = new Date(`${att.date}T${att.start_time}`);
        const end = new Date(`${att.date}T${att.end_time}`);
        const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        totalHours += hours;
        validRecords++;
      }
      if (att.break_minutes) {
        totalBreaks += att.break_minutes;
      }
    });

    stats.average_hours_per_day = validRecords > 0 ? totalHours / validRecords : 0;
    stats.total_break_time = totalBreaks;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            report_type: 'attendance_analytics',
            statistics: stats,
            employees_included: filteredEmployees.length,
            detailed_records: attendances,
          }, null, 2),
        },
      ],
    };
  }
}
