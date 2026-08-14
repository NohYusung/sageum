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
          cleanup_error: string | null;
          cleanup_started_at: string | null;
          completed_at: string | null;
          created_at: string;
          document_id: string | null;
          document_kind: string;
          file_name: string;
          folder_id: string | null;
          id: string;
          last_error: string | null;
          mime_type: string;
          original_available: boolean;
          owner_id: string;
          processing_token: string | null;
          retry_of_job_id: string | null;
          size_bytes: number;
          stage: string;
          started_at: string | null;
          status: string;
          updated_at: string;
          version_id: string | null;
          workflow_run_id: string | null;
        };
        Insert: {
          attempts?: number;
          cleanup_error?: string | null;
          cleanup_started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          document_id?: string | null;
          document_kind?: string;
          file_name: string;
          folder_id?: string | null;
          id?: string;
          last_error?: string | null;
          mime_type: string;
          original_available?: boolean;
          owner_id: string;
          processing_token?: string | null;
          retry_of_job_id?: string | null;
          size_bytes: number;
          stage?: string;
          started_at?: string | null;
          status?: string;
          updated_at?: string;
          version_id?: string | null;
          workflow_run_id?: string | null;
        };
        Update: {
          attempts?: number;
          cleanup_error?: string | null;
          cleanup_started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          document_id?: string | null;
          document_kind?: string;
          file_name?: string;
          folder_id?: string | null;
          id?: string;
          last_error?: string | null;
          mime_type?: string;
          original_available?: boolean;
          owner_id?: string;
          processing_token?: string | null;
          retry_of_job_id?: string | null;
          size_bytes?: number;
          stage?: string;
          started_at?: string | null;
          status?: string;
          updated_at?: string;
          version_id?: string | null;
          workflow_run_id?: string | null;
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
            isOneToOne: false;
            referencedRelation: 'document_versions';
            referencedColumns: ['id'];
          },
        ];
      };
      knowledge_rule_bindings: {
        Row: {
          chunk_id: string;
          chunk_text: string;
          created_at: string;
          document_id: string;
          id: string;
          owner_id: string;
          rule_id: string;
          updated_at: string;
          vector_score: number;
          version_id: string;
        };
        Insert: {
          chunk_id: string;
          chunk_text: string;
          created_at?: string;
          document_id: string;
          id?: string;
          owner_id: string;
          rule_id: string;
          updated_at?: string;
          vector_score: number;
          version_id: string;
        };
        Update: {
          chunk_id?: string;
          chunk_text?: string;
          created_at?: string;
          document_id?: string;
          id?: string;
          owner_id?: string;
          rule_id?: string;
          updated_at?: string;
          vector_score?: number;
          version_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'knowledge_rule_bindings_rule_owner_fkey';
            columns: ['rule_id', 'owner_id'];
            isOneToOne: false;
            referencedRelation: 'knowledge_rules';
            referencedColumns: ['id', 'owner_id'];
          },
          {
            foreignKeyName: 'knowledge_rule_bindings_version_document_owner_fkey';
            columns: ['version_id', 'document_id', 'owner_id'];
            isOneToOne: false;
            referencedRelation: 'document_versions';
            referencedColumns: ['id', 'document_id', 'owner_id'];
          },
          {
            foreignKeyName: 'knowledge_rule_bindings_chunk_fkey';
            columns: ['chunk_id'];
            isOneToOne: false;
            referencedRelation: 'document_chunks';
            referencedColumns: ['id'];
          },
        ];
      };
      knowledge_rule_links: {
        Row: {
          created_at: string;
          id: string;
          left_rule_id: string;
          owner_id: string;
          right_rule_id: string;
          updated_at: string;
          vector_score: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          left_rule_id: string;
          owner_id: string;
          right_rule_id: string;
          updated_at?: string;
          vector_score: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          left_rule_id?: string;
          owner_id?: string;
          right_rule_id?: string;
          updated_at?: string;
          vector_score?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'knowledge_rule_links_left_rule_owner_fkey';
            columns: ['left_rule_id', 'owner_id'];
            isOneToOne: false;
            referencedRelation: 'knowledge_rules';
            referencedColumns: ['id', 'owner_id'];
          },
          {
            foreignKeyName: 'knowledge_rule_links_right_rule_owner_fkey';
            columns: ['right_rule_id', 'owner_id'];
            isOneToOne: false;
            referencedRelation: 'knowledge_rules';
            referencedColumns: ['id', 'owner_id'];
          },
        ];
      };
      knowledge_rules: {
        Row: {
          confidence: number;
          created_at: string;
          enabled: boolean;
          evidence_end_offset: number;
          evidence_quote: string;
          evidence_start_offset: number;
          extraction_model: string;
          extraction_version: string;
          id: string;
          ordinal: number;
          owner_id: string;
          rule_document_id: string;
          rule_version_id: string;
          source_chunk_id: string;
          statement: string;
          updated_at: string;
        };
        Insert: {
          confidence: number;
          created_at?: string;
          enabled?: boolean;
          evidence_end_offset: number;
          evidence_quote: string;
          evidence_start_offset: number;
          extraction_model: string;
          extraction_version: string;
          id?: string;
          ordinal: number;
          owner_id: string;
          rule_document_id: string;
          rule_version_id: string;
          source_chunk_id: string;
          statement: string;
          updated_at?: string;
        };
        Update: {
          confidence?: number;
          created_at?: string;
          enabled?: boolean;
          evidence_end_offset?: number;
          evidence_quote?: string;
          evidence_start_offset?: number;
          extraction_model?: string;
          extraction_version?: string;
          id?: string;
          ordinal?: number;
          owner_id?: string;
          rule_document_id?: string;
          rule_version_id?: string;
          source_chunk_id?: string;
          statement?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'knowledge_rules_rule_document_owner_fkey';
            columns: ['rule_document_id', 'owner_id'];
            isOneToOne: false;
            referencedRelation: 'rule_documents';
            referencedColumns: ['document_id', 'owner_id'];
          },
          {
            foreignKeyName: 'knowledge_rules_rule_version_document_owner_fkey';
            columns: ['rule_version_id', 'rule_document_id', 'owner_id'];
            isOneToOne: false;
            referencedRelation: 'document_versions';
            referencedColumns: ['id', 'document_id', 'owner_id'];
          },
          {
            foreignKeyName: 'knowledge_rules_source_chunk_fkey';
            columns: ['source_chunk_id'];
            isOneToOne: false;
            referencedRelation: 'document_chunks';
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
      mcp_repository_permissions: {
        Row: {
          can_upload: boolean;
          client_id: string;
          created_at: string;
          owner_id: string;
          updated_at: string;
        };
        Insert: {
          can_upload?: boolean;
          client_id: string;
          created_at?: string;
          owner_id: string;
          updated_at?: string;
        };
        Update: {
          can_upload?: boolean;
          client_id?: string;
          created_at?: string;
          owner_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      documents: {
        Row: {
          created_at: string;
          deletion_status: string;
          document_kind: string;
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
          document_kind?: string;
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
          document_kind?: string;
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
      rule_documents: {
        Row: {
          created_at: string;
          document_id: string;
          enabled: boolean;
          extracted_at: string | null;
          extraction_error: string | null;
          extraction_status: string;
          extraction_warning: string | null;
          manual_content: string | null;
          owner_id: string;
          source_mode: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          document_id: string;
          enabled?: boolean;
          extracted_at?: string | null;
          extraction_error?: string | null;
          extraction_status?: string;
          extraction_warning?: string | null;
          manual_content?: string | null;
          owner_id: string;
          source_mode?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          document_id?: string;
          enabled?: boolean;
          extracted_at?: string | null;
          extraction_error?: string | null;
          extraction_status?: string;
          extraction_warning?: string | null;
          manual_content?: string | null;
          owner_id?: string;
          source_mode?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rule_documents_document_owner_fkey';
            columns: ['document_id', 'owner_id'];
            isOneToOne: true;
            referencedRelation: 'documents';
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
      complete_failed_ingestion_cleanup: {
        Args: {
          p_deletion_job_id: string;
          p_document_id: string;
          p_ingestion_job_id: string;
        };
        Returns: undefined;
      };
      delete_folder_trees: {
        Args: { p_folder_ids: string[] };
        Returns: string[];
      };
      mark_failed_ingestion_cleanup: {
        Args: {
          p_deletion_job_id: string;
          p_ingestion_job_id: string;
          p_message: string;
        };
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
      request_failed_ingestion_cleanup: {
        Args: { p_job_id: string };
        Returns: {
          cleanup_completed: boolean;
          deletion_job_id: string | null;
          document_id: string | null;
          ingestion_job_id: string;
          requires_vector_cleanup: boolean;
          storage_paths: string[];
        }[];
      };
      replace_knowledge_rule_extraction: {
        Args: {
          p_bindings: Json;
          p_links: Json;
          p_owner_id: string;
          p_rule_document_id: string;
          p_rule_version_id: string;
          p_rules: Json;
          p_document_source_type?: string | null;
          p_document_title?: string | null;
          p_manual_content?: string | null;
          p_preserve_rule_enabled?: boolean;
          p_source_mode?: string;
          p_warning?: string | null;
        };
        Returns: undefined;
      };
      replace_owner_knowledge_rule_graph: {
        Args: {
          p_bindings: Json;
          p_links: Json;
          p_owner_id: string;
        };
        Returns: undefined;
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
