// LLM providers with genuinely free tiers (no credit card). All speak the OpenAI
// chat format. Keys live only in the server's .env. Providers without a key are
// skipped, except keyless ones, which is why Pollinations is the final safety net.
// Server-only: the browser never sees this list.

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  /** Path appended to baseUrl for chat. Defaults to /chat/completions. */
  chatPath?: string;
  model: string;
  /** Substrings used to auto-pick a replacement when the default model is retired. */
  modelHints: string[];
  /** More free models on the same key. Each has its own daily allowance, so they back each other up. */
  alternates?: string[];
  envKey?: string;
  keyless?: boolean;
  keyUrl: string;
  note: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    modelHints: ['gpt-oss-120b', 'llama-3.3-70b', 'qwen', 'kimi', 'llama'],
    alternates: ['qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
    envKey: 'GROQ_API_KEY',
    keyUrl: 'https://console.groq.com/keys',
    note: 'Very fast. ~1,000 requests/day free.',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.5-flash',
    modelHints: ['gemini-3.5-flash', 'flash', 'gemma'],
    alternates: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-26b-a4b-it'],
    envKey: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/apikey',
    note: 'Big context, great at synthesis. Free via AI Studio.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (free models)',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-oss-120b:free',
    modelHints: ['gpt-oss-120b', 'llama-3.3-70b', 'deepseek', 'qwen3', 'gemma'],
    envKey: 'OPENROUTER_API_KEY',
    keyUrl: 'https://openrouter.ai/keys',
    note: 'Only ":free" models are ever used. ~50 req/day.',
  },
  {
    id: 'cohere',
    name: 'Cohere',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    model: 'command-a-03-2025',
    modelHints: ['command-a', 'command-r-plus', 'command-r'],
    envKey: 'COHERE_API_KEY',
    keyUrl: 'https://dashboard.cohere.com/api-keys',
    note: 'Free trial key, rate limited.',
  },
  {
    id: 'zai',
    name: 'Z.ai (GLM Flash)',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    model: 'glm-4.5-flash',
    modelHints: ['flash'],
    envKey: 'ZAI_API_KEY',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    note: 'GLM Flash models are free.',
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'nvidia/nemotron-3-super-120b-a12b',
    modelHints: ['nemotron-3-super', 'nemotron-3', 'nemotron', 'qwen'],
    envKey: 'NVIDIA_API_KEY',
    keyUrl: 'https://build.nvidia.com/settings/api-keys',
    note: 'Free endpoints for prototyping.',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face Router',
    baseUrl: 'https://router.huggingface.co/v1',
    model: 'openai/gpt-oss-120b',
    modelHints: ['gpt-oss', 'Llama-3.3-70B', 'Qwen'],
    envKey: 'HF_TOKEN',
    keyUrl: 'https://huggingface.co/settings/tokens',
    note: 'Small monthly free credit.',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1',
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    modelHints: ['llama-3.3-70b', 'gpt-oss', 'qwen'],
    envKey: 'CLOUDFLARE_API_TOKEN',
    keyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    note: '10k neurons/day free. Needs CLOUDFLARE_ACCOUNT_ID too.',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    modelHints: ['llama', 'qwen', 'mistral', 'gemma'],
    keyless: true,
    keyUrl: 'https://ollama.com/download',
    note: 'Runs on your own machine. Set OLLAMA_ENABLED=1.',
  },
  {
    id: 'pollinations',
    name: 'Pollinations',
    baseUrl: 'https://gen.pollinations.ai/v1',
    model: 'openai',
    modelHints: ['openai', 'mistral', 'deepseek'],
    envKey: 'POLLINATIONS_API_KEY',
    keyUrl: 'https://enter.pollinations.ai',
    note: 'Free key raises limits. The legacy endpoint below needs no key.',
  },
  {
    id: 'pollinations-legacy',
    name: 'Pollinations (legacy)',
    baseUrl: 'https://text.pollinations.ai',
    chatPath: '/openai',
    model: 'openai',
    modelHints: ['openai'],
    keyless: true,
    keyUrl: 'https://pollinations.ai',
    note: 'Last-resort keyless endpoint.',
  },
];

export const presetById = (id: string) => PROVIDER_PRESETS.find((p) => p.id === id);
