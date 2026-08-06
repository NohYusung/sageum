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
      document_ingestion_jobs: {
        Row: {
          attempts: number;
          completed_at: string | null;
          created_at: string;
          document_id: string | null;
          file_name: string;
          folder_id: string | null;
          id: string;
          last_error: string | null;
          mime_type: string;
          original_available: boolean;
          owner_id: string;
          retry_of_job_id: string | null;
          size_bytes: number;
          stage: string;
          started_at: string | null;
          status: string;
          updated_at: string;
          version_id: string | null;
        };
        Insert: {
          attempts?: number;
          completed_at?: string | null;
          created_at?: string;
          document_id?: string | null;
          file_name: string;
          folder_id?: string | null;
          id?: string;
          last_error?: string | null;
          mime_type: string;
          original_available?: boolean;
          owner_id: string;
          retry_of_job_id?: string | null;
          size_bytes: number;
          stage?: string;
          started_at?: string | null;
          status?: string;
          updated_at?: string;
          version_id?: string | null;
        };
        Update: {
          attempts?: number;
          completed_at?: string | null;
          created_at?: string;
          document_id?: string | null;
          file_name?: string;
          folder_id?: string | null;
          id?: string;
          last_error?: string | null;
          mime_type?: string;
          original_available?: boolean;
          owner_id?: string;
          retry_of_job_id?: string | null;
          size_bytes?: number;
          stage?: string;
          started_at?: string | null;
          status?: string;
          updated_at?: string;
          version_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'document_ingestion_jobs_document_id_fkey';
            columns: ['document_id'];
            isOneToOne: false;
            referencedRelation: 'documents';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'document_ingestion_jobs_retry_of_job_id_fkey';
            columns: ['retry_of_job_id'];
            isOneToOne: false;
            referencedRelation: 'document_ingestion_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'document_ingestion_jobs_version_id_fkey';
            columns: ['version_id'];
            isOneToOne: true;
            referencedRelation: 'document_versions';
            referencedColumns: ['id'];
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
          folder_id: string | null;
          id: string;
          latest_version_id: string | null;
          owner_id: string;
          sort_order: number;
          source_type: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deletion_status?: string;
          folder_id?: string | null;
          id?: string;
          latest_version_id?: string | null;
          owner_id: string;
          sort_order?: number;
          source_type: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deletion_status?: string;
          folder_id?: string | null;
          id?: string;
          latest_version_id?: string | null;
          owner_id?: string;
          sort_order?: number;
          source_type?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'documents_folder_owner_fkey';
            columns: ['folder_id', 'owner_id'];
            isOneToOne: false;
            referencedRelation: 'folders';
            referencedColumns: ['id', 'owner_id'];
          },
        ];
      };
      folders: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          owner_id: string;
          parent_id: string | null;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          owner_id: string;
          parent_id?: string | null;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          owner_id?: string;
          parent_id?: string | null;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'folders_parent_owner_fkey';
            columns: ['parent_id', 'owner_id'];
            isOneToOne: false;
            referencedRelation: 'folders';
            referencedColumns: ['id', 'owner_id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_document_ingestion_processing: {
        Args: {
          p_document_id: string;
          p_job_id: string;
          p_version_id: string;
        };
        Returns: {
          attempts: number;
          document_id: string;
          job_id: string;
          version_id: string;
        }[];
      };
      claim_document_ingestion_reupload: {
        Args: { p_job_id: string };
        Returns: {
          attempts: number;
          document_id: string;
          job_id: string;
          version_id: string;
        }[];
      };
      complete_document_deletion: {
        Args: { p_document_id: string; p_job_id: string };
        Returns: undefined;
      };
      move_document: {
        Args: { p_document_id: string; p_folder_id: string | null };
        Returns: undefined;
      };
      move_folder: {
        Args: { p_folder_id: string; p_parent_id: string | null };
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
