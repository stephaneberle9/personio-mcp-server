// Validation helpers for Personio MCP server

export interface EmployeeArgs {
  employee_id: number;
  attributes?: string[];
}

export interface EmployeesArgs {
  limit?: number;
  offset?: number;
  attributes?: string[];
  office?: string;
  format?: 'json' | 'csv';
}

export interface SearchArgs {
  query: string;
  limit?: number;
  offset?: number;
}

export interface AttendanceArgs {
  start_date?: string;
  end_date?: string;
  employee_ids?: number[];
  limit?: number;
  offset?: number;
}

export interface AbsenceArgs {
  start_date?: string;
  end_date?: string;
  employee_ids?: number[];
  limit?: number;
  offset?: number;
}

export interface BalanceArgs {
  employee_id: number;
}

export interface ReportArgs {
  start_date: string;
  end_date: string;
  employee_ids?: number[];
  department?: string;
}

export const isValidEmployeeArgs = (args: any): args is EmployeeArgs =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.employee_id === 'number' &&
  (args.attributes === undefined || Array.isArray(args.attributes));

export const isValidEmployeesArgs = (args: any): args is EmployeesArgs =>
  typeof args === 'object' &&
  args !== null &&
  (args.limit === undefined || typeof args.limit === 'number') &&
  (args.offset === undefined || typeof args.offset === 'number') &&
  (args.attributes === undefined || Array.isArray(args.attributes)) &&
  (args.office === undefined || typeof args.office === 'string') &&
  (args.format === undefined || args.format === 'json' || args.format === 'csv');

export const isValidSearchArgs = (args: any): args is SearchArgs =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.query === 'string' &&
  (args.limit === undefined || typeof args.limit === 'number') &&
  (args.offset === undefined || typeof args.offset === 'number');

export const isValidAttendanceArgs = (args: any): args is AttendanceArgs =>
  typeof args === 'object' &&
  args !== null &&
  (args.start_date === undefined || typeof args.start_date === 'string') &&
  (args.end_date === undefined || typeof args.end_date === 'string') &&
  (args.employee_ids === undefined || Array.isArray(args.employee_ids)) &&
  (args.limit === undefined || typeof args.limit === 'number') &&
  (args.offset === undefined || typeof args.offset === 'number');

export const isValidAbsenceArgs = (args: any): args is AbsenceArgs =>
  typeof args === 'object' &&
  args !== null &&
  (args.start_date === undefined || typeof args.start_date === 'string') &&
  (args.end_date === undefined || typeof args.end_date === 'string') &&
  (args.employee_ids === undefined || Array.isArray(args.employee_ids)) &&
  (args.limit === undefined || typeof args.limit === 'number') &&
  (args.offset === undefined || typeof args.offset === 'number');

export const isValidBalanceArgs = (args: any): args is BalanceArgs =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.employee_id === 'number';

export const isValidReportArgs = (args: any): args is ReportArgs =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.start_date === 'string' &&
  typeof args.end_date === 'string' &&
  (args.employee_ids === undefined || Array.isArray(args.employee_ids)) &&
  (args.department === undefined || typeof args.department === 'string');
