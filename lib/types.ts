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
  created_at: string;
};
