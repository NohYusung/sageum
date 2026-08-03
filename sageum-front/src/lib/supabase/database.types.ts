export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      document_chunks: {
        Row: {
          cell_range: string | null;
          created_at: string;
          document_id: string;
          end_offset: number | null;
          heading_path: string[];
          id: string;
          metadata: Json;
          ordinal: number;
          owner_id: string;
          page: number | null;
          sheet: string | null;
          start_offset: number | null;
          text: string;
          version_id: string;
          word_count: number;
        };
        Insert: {
          cell_range?: string | null;
          created_at?: string;
          document_id: string;
          end_offset?: number | null;
          heading_path?: string[];
          id: string;
          metadata?: Json;
          ordinal: number;
          owner_id: string;
          page?: number | null;
          sheet?: string | null;
          start_offset?: number | null;
          text: string;
          version_id: string;
          word_count: number;
        };
        Update: {
          cell_range?: string | null;
          created_at?: string;
          document_id?: string;
          end_offset?: number | null;
          heading_path?: string[];
          id?: string;
          metadata?: Json;
          ordinal?: number;
          owner_id?: string;
          page?: number | null;
          sheet?: string | null;
          start_offset?: number | null;
          text?: string;
          version_id?: string;
          word_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'document_chunks_version_document_owner_fkey';
            columns: ['version_id', 'document_id', 'owner_id'];
            isOneToOne: false;
            referencedRelation: 'document_versions';
            referencedColumns: ['id', 'document_id', 'owner_id'];
          },
        ];
      };
      document_deletion_jobs: {
        Row: {
          attempts: number;
          created_at: string;
          document_id: string;
          id: string;
          last_error: string | null;
          owner_id: string;
          requires_vector_cleanup: boolean;
          status: string;
          storage_paths: string[];
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          document_id: string;
          id?: string;
          last_error?: string | null;
          owner_id: string;
          requires_vector_cleanup?: boolean;
          status?: string;
          storage_paths?: string[];
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          document_id?: string;
          id?: string;
          last_error?: string | null;
          owner_id?: string;
          requires_vector_cleanup?: boolean;
          status?: string;
          storage_paths?: string[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'document_deletion_jobs_document_owner_fkey';
            columns: ['document_id', 'owner_id'];
            isOneToOne: true;
            referencedRelation: 'documents';
            referencedColumns: ['id', 'owner_id'];
          },
        ];
      };
      document_versions: {
        Row: {
          content_hash: string | null;
          created_at: string;
          document_id: string;
          error_message: string | null;
          id: string;
          metadata: Json;
          mime_type: string;
          original_filename: string;
          owner_id: string;
          size_bytes: number;
          status: string;
          storage_path: string;
        };
        Insert: {
          content_hash?: string | null;
          created_at?: string;
          document_id: string;
          error_message?: string | null;
          id?: string;
          metadata?: Json;
          mime_type: string;
          original_filename: string;
          owner_id: string;
          size_bytes: number;
          status?: string;
          storage_path: string;
        };
        Update: {
          content_hash?: string | null;
          created_at?: string;
          document_id?: string;
          error_message?: string | null;
          id?: string;
          metadata?: Json;
          mime_type?: string;
          original_filename?: string;
          owner_id?: string;
          size_bytes?: number;
          status?: string;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'document_versions_document_owner_fkey';
            columns: ['document_id', 'owner_id'];
            isOneToOne: false;
            referencedRelation: 'documents';
            referencedColumns: ['id', 'owner_id'];
          },
        ];
      };
      documents: {
        Row: {
          created_at: string;
          deletion_status: string;
          id: string;
          latest_version_id: string | null;
          owner_id: string;
          source_type: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deletion_status?: string;
          id?: string;
          latest_version_id?: string | null;
          owner_id: string;
          source_type: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deletion_status?: string;
          id?: string;
          latest_version_id?: string | null;
          owner_id?: string;
          source_type?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      complete_document_deletion: {
        Args: { p_document_id: string; p_job_id: string };
        Returns: undefined;
      };
      request_document_deletion: {
        Args: { p_document_id: string };
        Returns: {
          job_id: string;
          requires_vector_cleanup: boolean;
          storage_paths: string[];
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
