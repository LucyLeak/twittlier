# Twittlier

Base inicial de rede social privada, estilo Twitter, com:

- barreira de acesso inicial por codigo privado
- login de usuario com Google (Supabase Auth)
- feed com post de texto
- upload de foto, video e gif (Supabase Storage)
- interface simples estilo anos 90

## Stack

- Next.js (App Router)
- Supabase (Auth, Postgres, Storage)
- Deploy no Vercel

## Requisitos

- Node.js 20+
- Projeto Supabase criado
- Repositorio conectado no Vercel

## 1) Configurar banco no Supabase

1. Abra o painel do Supabase.
2. Va em `SQL Editor`.
3. Execute o conteudo de `supabase/schema.sql`.

Isso cria:

- tabela `accounts` com `user_id`, `name`, `handle` (@), `youtube_account` e `profile_photo_url`
- tabela `posts`
- politicas RLS
- bucket publico `post-media` com politicas de upload por pasta do usuario

## 2) Configurar variaveis de ambiente

Copie `.env.example` para `.env.local` e preencha:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=SUA_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_SITE_URL=https://seu-app.vercel.app
SITE_ACCESS_CODE=seu-codigo-privado
```

Compatibilidade: `NEXT_PUBLIC_SUPABASE_ANON_KEY` tambem funciona (legado).
`NEXT_PUBLIC_SITE_URL` e recomendado para redirect do login OAuth.

### No Vercel

No projeto da Vercel, adicione as mesmas variaveis em:

- `Settings` -> `Environment Variables`

## 2.1) Configurar URL de autenticacao no Supabase

Em `Supabase > Authentication > URL Configuration`:

- `Site URL`: coloque seu dominio de producao (ex.: `https://seu-app.vercel.app`)
- `Redirect URLs`: inclua:
  - `https://seu-app.vercel.app/auth`
  - `http://localhost:3000/auth` (para desenvolvimento local)

## 3) Rodar localmente

```bash
npm install
npm run dev
```

Acesse:

- `http://localhost:3000/acesso` para passar pelo login privado inicial.

## Fluxo atual do app

1. Usuario entra em `/acesso` e informa o codigo privado (`SITE_ACCESS_CODE`).
2. Com acesso liberado, vai para `/auth` e faz login com Google.
3. Em `/`, publica texto, foto, video ou gif no feed privado.

## Observacoes importantes

- Em `Supabase > Authentication > Providers > Google`, habilite Google OAuth.
- Em `Supabase > Authentication > Providers > Google`, use callback URL do Supabase no console do Google.
- Essa e a base inicial intencionalmente simples para evoluir nos proximos pedidos.
