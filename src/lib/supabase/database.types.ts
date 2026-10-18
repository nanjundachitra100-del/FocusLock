type Table<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type FocusSessionStatus = "in_progress" | "completed" | "abandoned";
export type RewardTransactionType = "earned" | "spent";

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        {
          id: string;
          display_name: string;
          created_at: string;
          updated_at: string;
        },
        {
          id: string;
          display_name?: string;
          created_at?: string;
          updated_at?: string;
        },
        { display_name?: string; updated_at?: string }
      >;
      focus_sessions: Table<
        {
          id: string;
          user_id: string;
          started_at: string;
          ended_at: string | null;
          duration_seconds: number | null;
          status: FocusSessionStatus;
          created_at: string;
        },
        {
          id?: string;
          user_id: string;
          started_at?: string;
          ended_at?: string | null;
          duration_seconds?: number | null;
          status?: FocusSessionStatus;
          created_at?: string;
        },
        {
          ended_at?: string | null;
          duration_seconds?: number | null;
          status?: FocusSessionStatus;
        }
      >;
      quiz_attempts: Table<
        {
          id: string;
          user_id: string;
          focus_session_id: string | null;
          score: number;
          total_questions: number;
          passed: boolean;
          created_at: string;
        },
        {
          id?: string;
          user_id: string;
          focus_session_id?: string | null;
          score: number;
          total_questions: number;
          passed: boolean;
          created_at?: string;
        },
        never
      >;
      reward_transactions: Table<
        {
          id: string;
          user_id: string;
          transaction_type: RewardTransactionType;
          minutes: number;
          reference_id: string | null;
          created_at: string;
        },
        {
          id?: string;
          user_id: string;
          transaction_type: RewardTransactionType;
          minutes: number;
          reference_id?: string | null;
          created_at?: string;
        },
        never
      >;
      entertainment_sessions: Table<
        {
          id: string;
          user_id: string;
          minutes: number;
          started_at: string;
          expires_at: string;
          ended_at: string | null;
          status: "active" | "completed" | "expired" | "abandoned";
          created_at: string;
        },
        {
          id?: string;
          user_id: string;
          minutes: number;
          started_at?: string;
          expires_at: string;
          ended_at?: string | null;
          status?: "active" | "completed" | "expired" | "abandoned";
          created_at?: string;
        },
        {
          ended_at?: string | null;
          status?: "active" | "completed" | "expired" | "abandoned";
        }
      >;
      user_blocked_sites: Table<
        {
          id: string;
          user_id: string;
          domain: string;
          enabled: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          domain: string;
          enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        },
        {
          domain?: string;
          enabled?: boolean;
          updated_at?: string;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      record_quiz_attempt_and_reward: {
        Args: {
          p_user_id: string;
          p_quiz_id: string;
          p_score: number;
          p_total_questions: number;
          p_focus_session_id?: string | null;
        };
        Returns: {
          attempt_id: string;
          passed: boolean;
          score: number;
          total_questions: number;
          reward_minutes: number;
          available_minutes: number;
        };
      };
      spend_reward_minutes: {
        Args: {
          p_minutes: number;
          p_session_id?: string | null;
        };
        Returns: {
          session_id: string;
          minutes: number;
          started_at: string;
          expires_at: string;
          status: string;
          available_minutes: number;
        };
      };
      end_entertainment_session: {
        Args: {
          p_session_id: string;
        };
        Returns: {
          session_id: string;
          status: string;
          ended_at: string;
        };
      };
      replace_user_blocked_sites: {
        Args: {
          p_sites: { domain: string; enabled: boolean }[];
        };
        Returns: {
          sites: {
            domain: string;
            enabled: boolean;
          }[];
        };
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};