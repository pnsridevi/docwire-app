export type Role = 'client' | 'accountant' | 'manager' | 'client_admin' | 'super_admin';

export type Profile = {
  id: string;
  tenant_id: string;
  client_org_id: string | null;
  name: string | null;
  role: Role;
};

export type Doc = {
  id: string;
  name: string;
  status: 'pending' | 'accounted' | 'reviewed' | 'rework' | 'filed';
  needs_entry: boolean;
  client_org_id: string;
  comment: string | null;
  created_at: string;
};

export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskStatus = 'in_progress' | 'completed';

export type Task = {
  id: string;
  tenant_id: string;
  client_org_id: string;
  title: string;
  description: string | null;
  creator_id: string;
  creator_name: string | null;
  creator_role: Role;
  assignee_id: string;
  assignee_name: string | null;
  assignee_role: Role;
  priority: TaskPriority;
  due_date: string | null;
  status: TaskStatus;
  created_at: string;
};

// A lightweight person reference used to populate assignee pickers.
//
// `key` exists separately from `id` because the SAME person can appear
// as more than one valid option — e.g. an Accountant who serves two of a
// Manager's clients shows up once per client, each tied to a different
// client_org_id. Using `id` alone as the picker's selection key would make
// those two entries indistinguishable (selecting either one would resolve
// to whichever came first in the list), silently filing a task under the
// wrong client. `key` is `${id}::${client_org_id}` so each option is
// always unique, even when the underlying person repeats.
export type AssignableUser = {
  key: string;
  id: string;
  name: string | null;
  role: Role;
  client_org_id: string;
  client_org_name: string;
};