# Twittlier

Base inicial de rede social privada, estilo Twitter, com:

- barreira de acesso inicial por codigo privado
- cadastro/login por email e senha (Supabase Auth)
- confirmacao de email opcional em `Configuracoes` (manual)
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

- tabela `accounts` com `user_id`, `name`, `handle` (@), `youtube_account`, `profile_photo_url`, `email_verified_optional` e `email_verified_at`
- tabela `posts`
- politicas RLS
- bucket publico `post-media` com politicas de upload por pasta do usuario

## 2) Configurar variaveis de ambiente

Copie `.env.example` para `.env.local` e preencha:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=SUA_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=SUA_SUPABASE_SERVICE_ROLE_KEY
SITE_ACCESS_CODE=seu-codigo-privado
```

Compatibilidade: `NEXT_PUBLIC_SUPABASE_ANON_KEY` tambem funciona (legado).

### No Vercel

No projeto da Vercel, adicione as mesmas variaveis em:

- `Settings` -> `Environment Variables`

## 3) Rodar localmente

```bash
npm install
npm run dev
```

Acesse:

- `http://localhost:3000/acesso` para passar pelo login privado inicial.

## 4) Auth sem confirmacao obrigatoria

Em `Supabase > Authentication > Providers > Email`:

- deixe `Email` habilitado
- desative `Confirm email`

Com isso, a pessoa cadastra e entra direto sem validar email.
Se quiser confirmar depois, pode usar o botao em `/configuracoes`.

Observacao: o cadastro usa rota server-side (`/api/auth/register`) com
`SUPABASE_SERVICE_ROLE_KEY` para criar usuario ja confirmado.
Nunca exponha essa chave no frontend.

## Fluxo atual do app

1. Usuario entra em `/acesso` e informa o codigo privado (`SITE_ACCESS_CODE`).
2. Com acesso liberado, vai para `/auth` e cria conta ou faz login.
3. Em `/`, publica texto, foto, video ou gif no feed privado.
4. Se quiser, entra em `/configuracoes` e clica em `Confirmar email`.

## Observacoes importantes

- O botao `Confirmar email` marca confirmacao opcional em `accounts.email_verified_optional`.
- Essa e a base inicial intencionalmente simples para evoluir nos proximos pedidos.
