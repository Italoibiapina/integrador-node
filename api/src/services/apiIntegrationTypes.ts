export interface ApiEndpointConfig {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
}

export interface ApiAuthConfig {
  id: string;
  name: string;
  auth_type?: string;
  base_url: string;
  username?: string;
  password?: string;
  last_token?: string;
  token_expires_at?: Date;
  extra_headers: Record<string, string>;
  created_at: Date;
  updated_at: Date;
}

export interface ApiServiceGetParam {
  id?: string;
  service_id?: string;
  name: string;
  value_type: 'text' | 'number' | 'date';
  value: string;
  sort_order?: number;
}

export interface ApiService {
  id: string;
  auth_config_id: string;
  name: string;
  service_name?: string;
  endpoint_url?: string;
  parametro_get?: string | null;
  description?: string;
  is_active: boolean;
  last_run_at?: Date;
  current_status: 'idle' | 'running' | 'error';
  parametros?: Record<string, unknown> | null; // usado para POST
  get_params?: ApiServiceGetParam[];
  endpoints?: Record<string, ApiEndpointConfig>; // legado para compatibilidade
  created_at: Date;
  updated_at: Date;
}

export interface ApiBatch {
  id: string;
  name?: string;
  description?: string;
  is_active?: boolean;
  endpoints?: Record<string, ApiEndpointConfig>;
  auth_config_id?: string;
  
  started_at: Date;
  finished_at?: Date;
  status: 'running' | 'success' | 'failed' | 'partial';
  trigger_type: 'manual' | 'scheduled';
  error_message?: string;
  raw_response?: any;
  created_at: Date;
}

export interface ApiServiceExecution {
  id: string;
  batch_id: string;
  service_id: string;
  parent_execution_id?: string | null;
  
  // Snapshot da configuração usada (Serviço + Auth)
  snapshot_config: {
    service: Partial<ApiService>;
    auth: Partial<ApiAuthConfig>;
  };
  
  started_at: Date;
  finished_at?: Date;
  status: 'success' | 'failed' | 'running';
  error_message?: string;
  raw_response?: any;
}

export interface SistemaDestinoConfig {
  id: number;
  nome: string;
  tabela_origem: string;
  entidade_view: string;
  endpoint_url: string;
  metodo: string;
  ativo: boolean;
  conexao_api_id: string;
  criado_em: Date;
}
