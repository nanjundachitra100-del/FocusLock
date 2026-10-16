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
    };
    Views: Record<string, never>;
    Functions: {
      record_quiz_attempt_and_reward: {
        Args: {
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};