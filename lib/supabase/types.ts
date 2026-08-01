export type RequestKind = "grant_admin" | "apply_fix";
export type RequestStatus = "pending" | "approved" | "expired" | "cancelled";

export type CardRow = {
  id: string;
  label: string;
  holder_name: string;
  active: boolean;
};

export type PendingRequestRow = {
  id: string;
  kind: RequestKind;
  payload: Record<string, unknown>;
  requested_by: string;
  reason: string;
  dual_control: boolean;
  created_at: string;
  expires_at: string;
  status: RequestStatus;
};

export type TapRow = {
  id: string;
  card_id: string;
  request_id: string;
  created_at: string;
};

export type GrantRow = {
  id: string;
  subject_id: string;
  role: string;
  target: string;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
};

export type AuditRow = {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
};

export type Database = {
  public: {
    Tables: {
      cards: {
        Row: CardRow;
        Insert: {
          id?: string;
          label: string;
          holder_name: string;
          active?: boolean;
        };
        Update: {
          id?: string;
          label?: string;
          holder_name?: string;
          active?: boolean;
        };
        Relationships: [];
      };
      pending_requests: {
        Row: PendingRequestRow;
        Insert: {
          id?: string;
          kind: RequestKind;
          payload?: Record<string, unknown>;
          requested_by: string;
          reason?: string;
          dual_control?: boolean;
          created_at?: string;
          expires_at?: string;
          status?: RequestStatus;
        };
        Update: {
          id?: string;
          kind?: RequestKind;
          payload?: Record<string, unknown>;
          requested_by?: string;
          reason?: string;
          dual_control?: boolean;
          created_at?: string;
          expires_at?: string;
          status?: RequestStatus;
        };
        Relationships: [];
      };
      taps: {
        Row: TapRow;
        Insert: {
          id?: string;
          card_id: string;
          request_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          card_id?: string;
          request_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "taps_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "taps_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "pending_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      grants: {
        Row: GrantRow;
        Insert: {
          id?: string;
          subject_id: string;
          role: string;
          target: string;
          granted_at?: string;
          expires_at?: string;
          revoked_at?: string | null;
        };
        Update: {
          id?: string;
          subject_id?: string;
          role?: string;
          target?: string;
          granted_at?: string;
          expires_at?: string;
          revoked_at?: string | null;
        };
        Relationships: [];
      };
      audit: {
        Row: AuditRow;
        Insert: {
          id?: string;
          at?: string;
          actor: string;
          action: string;
          detail?: Record<string, unknown>;
        };
        Update: {
          id?: string;
          at?: string;
          actor?: string;
          action?: string;
          detail?: Record<string, unknown>;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      request_kind: RequestKind;
      request_status: RequestStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
