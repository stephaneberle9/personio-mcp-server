import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { PersonioClient } from '../api/personio-client.js';
import { paginateStyleA } from '../utils/pagination.js';

// Advertised bounds (mirror inputSchema): pending approvals default 50, the
// approval-status tools default 100; all cap at 200.
const PENDING_APPROVALS_BOUNDS = { defaultLimit: 50, maxLimit: 200 };
const APPROVAL_STATUS_BOUNDS = { defaultLimit: 100, maxLimit: 200 };

export class ApprovalHandlers {
  constructor(private personioClient: PersonioClient) {}

  async handleCreateAttendanceWithApproval(args: any) {
    if (!args || typeof args.employee_id !== 'number' || !args.date || !args.start_time || !args.end_time) {
      throw new McpError(ErrorCode.InvalidParams, 'employee_id, date, start_time, and end_time are required');
    }

    try {
      const response = await this.personioClient.createAttendanceWithApproval({
        employee_id: args.employee_id,
        date: args.date,
        start_time: args.start_time,
        end_time: args.end_time,
        break_minutes: args.break_minutes,
        comment: args.comment,
        skip_approval: args.skip_approval || false,
      });

      // V1 create response has a different format than GET:
      // { success: true, data: { message: "...", id: [{ id: 123 }] } }
      const responseData = response.data as any;
      const createdIds = responseData?.id || responseData?.ids || [];

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: response.success !== false,
              created_ids: createdIds,
              attendance: {
                employee_id: args.employee_id,
                date: args.date,
                start_time: args.start_time,
                end_time: args.end_time,
                break_minutes: args.break_minutes || 0,
                comment: args.comment || '',
              },
              approval_required: !args.skip_approval,
              message: args.skip_approval
                ? 'Attendance record created without approval'
                : 'Attendance record created and sent for approval',
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to create attendance record: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async handleGetPendingApprovals(args: any) {
    try {
      const response = await this.personioClient.getPendingApprovals({
        type: args?.type,
        employee_id: args?.employee_id,
        limit: args?.limit,
        offset: args?.offset,
      });

      // Forwarded offset/limit are honored server-side; only defensively clamp
      // `limit` here, never re-apply `offset`.
      const { items: pendingApprovals, offset, limit, total } = paginateStyleA(
        response.data,
        { offset: args?.offset, limit: args?.limit },
        PENDING_APPROVALS_BOUNDS,
        { mode: 'server', total: response.metadata?.total_elements ?? response.data.length }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              pending_approvals: pendingApprovals,
              count: pendingApprovals.length,
              total,
              offset,
              limit,
              filters: {
                type: args?.type,
                employee_id: args?.employee_id,
              },
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      // If the endpoint doesn't exist, return a helpful message
      if (error instanceof Error && error.message.includes('404')) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                message: 'Pending approvals endpoint is not available in the current Personio API version',
                suggestion: 'Use specific endpoints like attendance records with approval status',
                available_alternatives: [
                  'get_attendance_records - Check attendance records that may need approval',
                  'get_absences - Check absence requests with approval status',
                ],
              }, null, 2),
            },
          ],
        };
      }
      throw new McpError(ErrorCode.InternalError, `Failed to get pending approvals: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async handleGetAttendanceApprovalStatus(args: any) {
    if (!args || (!args.employee_id && !args.start_date)) {
      throw new McpError(ErrorCode.InvalidParams, 'Either employee_id or start_date is required');
    }

    try {
      const response = await this.personioClient.getAttendances({
        start_date: args.start_date,
        end_date: args.end_date || args.start_date,
        employees: args.employee_id ? [args.employee_id] : undefined,
        limit: args.limit,
        offset: args.offset,
      });

      const allAttendances = response.data.map(att => {
        const formatted = this.personioClient.formatAttendanceData(att);
        return {
          ...formatted,
          // Note: Approval status might not be directly available in the API response
          // This is a placeholder for potential approval status logic
          approval_status: 'unknown', // Would need to be determined from API response
          requires_approval: formatted.comment ? true : false, // Example logic
        };
      });

      // Forwarded offset/limit are honored server-side; only defensively clamp
      // `limit` here, never re-apply `offset`.
      const { items: attendances, offset, limit, total } = paginateStyleA(
        allAttendances,
        { offset: args.offset, limit: args.limit },
        APPROVAL_STATUS_BOUNDS,
        { mode: 'server', total: response.metadata?.total_elements ?? allAttendances.length }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              attendance_records: attendances,
              count: attendances.length,
              total,
              offset,
              limit,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to get attendance approval status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async handleGetAbsenceApprovalStatus(args: any) {
    if (!args || (!args.employee_id && !args.start_date)) {
      throw new McpError(ErrorCode.InvalidParams, 'Either employee_id or start_date is required');
    }

    try {
      const response = await this.personioClient.getAbsences({
        start_date: args.start_date,
        end_date: args.end_date || args.start_date,
        employees: args.employee_id ? [args.employee_id] : undefined,
        limit: args.limit,
        offset: args.offset,
      });

      const allAbsences = response.data.map(abs => {
        const formatted = this.personioClient.formatAbsenceData(abs);
        return {
          ...formatted,
          approval_status: formatted.status, // Status often indicates approval state
          is_pending: formatted.status === 'pending',
          is_approved: formatted.status === 'approved',
          is_rejected: formatted.status === 'rejected',
        };
      });

      // Forwarded offset/limit are honored server-side; only defensively clamp
      // `limit` here, never re-apply `offset`.
      const { items: absences, offset, limit, total } = paginateStyleA(
        allAbsences,
        { offset: args.offset, limit: args.limit },
        APPROVAL_STATUS_BOUNDS,
        { mode: 'server', total: response.metadata?.total_elements ?? allAbsences.length }
      );

      // Group by approval status over the returned page.
      const summary = {
        total: absences.length,
        pending: absences.filter(a => a.is_pending).length,
        approved: absences.filter(a => a.is_approved).length,
        rejected: absences.filter(a => a.is_rejected).length,
        other: absences.filter(a => !a.is_pending && !a.is_approved && !a.is_rejected).length,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              absence_records: absences,
              count: absences.length,
              total,
              offset,
              limit,
              summary,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to get absence approval status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async handleGetApprovalWorkflowSummary(args: any) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const startDate = args?.start_date || today;
      const endDate = args?.end_date || today;

      // Get attendance and absence data for the date range
      const [attendanceResponse, absenceResponse] = await Promise.all([
        this.personioClient.getAttendances({
          start_date: startDate,
          end_date: endDate,
          limit: 200,
        }),
        this.personioClient.getAbsences({
          start_date: startDate,
          end_date: endDate,
          limit: 200,
        }),
      ]);

      const attendances = attendanceResponse.data.map(att => 
        this.personioClient.formatAttendanceData(att)
      );

      const absences = absenceResponse.data.map(abs => 
        this.personioClient.formatAbsenceData(abs)
      );

      // Analyze approval statuses
      const summary = {
        date_range: { start_date: startDate, end_date: endDate },
        attendance: {
          total_records: attendances.length,
          // Note: Actual approval status would depend on API response structure
          potentially_requiring_approval: attendances.filter(a => a.comment).length,
        },
        absences: {
          total_records: absences.length,
          pending: absences.filter(a => a.status === 'pending').length,
          approved: absences.filter(a => a.status === 'approved').length,
          rejected: absences.filter(a => a.status === 'rejected').length,
          by_status: {} as Record<string, number>,
        },
        total_items_needing_attention: 0,
      };

      // Count absences by status
      absences.forEach(abs => {
        summary.absences.by_status[abs.status] = (summary.absences.by_status[abs.status] || 0) + 1;
      });

      summary.total_items_needing_attention = 
        summary.attendance.potentially_requiring_approval + 
        summary.absences.pending;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              approval_workflow_summary: summary,
              recommendations: [
                summary.absences.pending > 0 ? `${summary.absences.pending} absence requests need approval` : null,
                summary.attendance.potentially_requiring_approval > 0 ? `${summary.attendance.potentially_requiring_approval} attendance records may need review` : null,
              ].filter(Boolean),
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Failed to get approval workflow summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
