# Prontus

Nome do app: **Prontus** (subtítulo "Anamnese padronizada"). App web para profissionais e estudantes de medicina padronizarem anamneses. A pessoa envia um PDF (ou imagem) de uma ficha de anamnese, a IA extrai as seções e campos, a pessoa revisa e edita a estrutura, salva como **modelo** na conta, preenche **anamneses** a partir dele e exporta um PDF formatado.

## Stack

- Next.js (App Router) + TypeScript (strict)
- Tailwind CSS + shadcn/ui
- react-hook-form + zod (validação de formulários e do JSON da IA)
- dnd-kit (reordenar seções e campos no editor de modelo)
- Supabase: Auth, Postgres, Storage (`@supabase/ssr`)
- Gemini API para ler o PDF/imagem (chamada só no servidor, com saída estruturada via JSON schema)
- @react-pdf/renderer para o PDF de saída
- Deploy na Vercel

## Fluxo principal

1. **Novo modelo**: upload de PDF/imagem → arquivo vai para o bucket do Supabase → rota de API envia ao Gemini → retorna JSON de seções/campos.
2. **Revisão do modelo**: a pessoa edita títulos, adiciona/remove/reordena seções e campos, muda o tipo de campo e dá um título ao modelo (ex.: "Anamnese Pediátrica"). Salva na conta.
3. **Nova Anamnese**: escolhe um modelo salvo → formulário gerado a partir do schema → autosave.
4. **Histórico**: lista de anamneses preenchidas, com busca e filtro por modelo; abrir, editar, duplicar, excluir.
5. **Exportar**: PDF formatado seguindo o padrão abaixo.

## Extração com IA (Gemini)

- A IA deve extrair **somente o que é campo a ser preenchido** na anamnese.
- **Ignorar** anexos e material de referência: escalas (Bristol, Denver, ...), calendário vacinal, estágios de Tanner, tabelas de percentis (PA, circunferência abdominal), cabeçalhos/logos institucionais, nome do professor etc. Se um campo da ficha só aponta para um anexo (ex.: "Vacinas: ver calendário vacinal"), manter o campo e descartar o anexo.
- Cada seção recebe uma **sigla** quando houver uma consagrada (ID, QP, HDA, HPP, HF etc.); caso contrário, o título por extenso.
- Sempre garantir uma seção **#CONDUTA:** no final, mesmo que o PDF não tenha.
- Validar a resposta com zod antes de usar. Se falhar, mostrar erro amigável e permitir criar o modelo manualmente.
- A IA gera um rascunho; a pessoa sempre revisa antes de salvar.

### Schema do modelo (JSONB em `templates.schema`)

```ts
type Template = {
  sections: {
    id: string;
    title: string;        // ex.: "ALIMENTAÇÃO"
    abbreviation?: string; // ex.: "QP", "HDA"
    singleLine?: boolean;  // respostas na mesma linha (padrão na #ID)
    fields: {
      id: string;
      label: string;      // ex.: "ALEITAMENTO MATERNO EXCLUSIVO"
      type: "short_text" | "long_text" | "yes_no" | "number" | "date" | "select";
      options?: string[]; // para select
      hint?: string;      // ex.: "Escala de Bristol", faixas de tempo de tela
    }[];
  }[];
};
```

## Padrão de formatação da anamnese (PDF exportado e pré-visualização)

- **Tudo em CAIXA ALTA**, inclusive o texto digitado (converter na exportação; no formulário a pessoa digita normalmente).
- Título de seção sempre com `#` antes e `:` depois, usando a sigla quando existir.
- Subcampos com `-` antes, o rótulo, `:` e a resposta na mesma linha.
- Campos sem resposta são omitidos na exportação.
- A seção `#CONDUTA:` sempre aparece.

Exemplo:

```
#ID: MARIA S., 2 ANOS, NATURAL DE SOBRAL-CE, ACOMPANHADA PELA MÃE
#QP: FEBRE HÁ 3 DIAS
#HDA: ...
#HPP: ...
#ALIMENTAÇÃO:
-ALEITAMENTO MATERNO EXCLUSIVO: ATÉ 6 MESES
-INTRODUÇÃO ALIMENTAR: ...
#CONDUTA: ...
```

O PDF deve ser limpo e legível: fonte sem serifa, boa hierarquia, cabeçalho com título do modelo, data e identificação curta do paciente.

## Banco de dados (Supabase)

- `profiles`: user_id (pk), full_name, institution, created_at, updated_at (criado por trigger no cadastro)
- `specialties`: id, user_id, name (único por usuário, sem diferenciar maiúsculas), default_template_id, created_at, updated_at
- `templates`: id, user_id, title, specialty_id, schema (jsonb), source_file_path, created_at, updated_at
- `anamneses`: id, user_id, template_id, template_snapshot (jsonb), title, patient_label, answers (jsonb), created_at, updated_at
- `notes`: id, user_id, title, content, created_at, updated_at (Bloco de Notas)
- `appointments`: id, user_id, date, start_time, end_time, title, location, notes, series_id (repetição semanal), created_at, updated_at (Calendário)
- `extraction_events`: id, user_id, created_at (limite de leituras com IA: 10/h e 30/dia, via `claim_extraction()`; RLS impede alterar ou apagar eventos recentes)
- FKs entre tabelas são compostas `(id, user_id)`, então ninguém liga dados a registros de outra pessoa. Migrations ficam em `supabase/migrations/` (mesmas versões aplicadas pelo MCP); tipos em `src/lib/supabase/database.types.ts` (regenerar após cada migration).
- Guardar um snapshot do schema do modelo na anamnese (ou versionar o modelo), para que editar o modelo depois não quebre anamneses antigas.
- Toda alteração de banco via migrations.

## Segurança (obrigatório)

- **RLS ativado em todas as tabelas**, com policies `auth.uid() = user_id` para select/insert/update/delete. Tabelas criadas por SQL não vêm com RLS ligado; ativar explicitamente.
- **Bucket privado**, com policies de storage para que cada usuário acesse apenas a própria pasta (`{user_id}/...`). Usar signed URLs para leitura.
- `GEMINI_API_KEY` só no servidor (sem prefixo `NEXT_PUBLIC_`).
- A chave `service_role` do Supabase nunca vai para o client.
- Dados de saúde são sensíveis (LGPD): identificar paciente por iniciais/código em `patient_label`; não coletar CPF, endereço etc.
- Depois de criar o banco, conferir o Security Advisor do Supabase.

## Projeto Supabase

- Project ref: `tdsgtptitxguknwugxel` (usado pelo MCP)
- URL: `https://tdsgtptitxguknwugxel.supabase.co`
- Região: `us-east-2` (configurar as funções da Vercel na região mais próxima)
- Bucket: `anamneses-docs` (já criado; deve ser privado; não criar outro)
- Login: e-mail e senha
- O MCP do Supabase está conectado: usar para migrations, policies e consultas. Não pedir senha do banco.
- Chaves ficam só no `.env.local` (fora do Git) e nas variáveis da Vercel. Nunca escrever chaves neste arquivo nem no código.

## Variáveis de ambiente

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
GEMINI_API_KEY=
SUPABASE_SECRET_KEY= # só servidor; usada apenas para excluir conta
```

Manter um `.env.example` atualizado. Configurar as mesmas variáveis na Vercel.

## Design

Referência visual: `docs/referencia-design.jpeg` (só local, fora do Git). Tema escuro vinho (padrão) e claro rosa, escolhidos em Configurações; cards translúcidos (glass) com bordas suaves, cantos arredondados, acento da primária nos botões principais e item ativo da sidebar.

Marca: símbolo em SVG ("P" em contorno com linhas de ficha e um check) em `src/components/app-shell/prontus-mark.tsx`, usado pelo `Brand` (sidebar, barra do celular, login). O degradê do símbolo e do nome usa `--logo-from`/`--logo-to` em `globals.css`, definidos por tema. O ícone da aba é `src/app/icon.svg` (segue o tema do sistema, com as mesmas cores). O repositório no GitHub é `fabianocd/prontus` (público); o projeto na Vercel e o `package.json` continuam `anamnese-padronizada`. Sidebar com: Modelos, Nova Anamnese, Histórico, Calendário, Bloco de Notas, Configurações. Sem barra do topo no desktop (a sidebar já navega); no celular, barra fina com menu e marca. Páginas internas têm link "← Voltar" acima do título (`PageHeader` com `back`). Responsivo (funcionar bem no celular). Interface em português.

## Arquivos de referência

- `docs/PLANO.md`: **plano por fases, decisões já tomadas e itens futuros. Ler antes de continuar o trabalho e atualizar ao concluir cada fase.**
- `docs/anamnese-pediatrica-exemplo.pdf`: ficha de exemplo para testar a extração.
- `docs/referencia-design.jpeg`: referência de design.
- Esses dois arquivos são material de terceiros: ficam só na máquina local (no `.gitignore`) e **nunca** devem ser commitados, porque o repositório é público.

## Convenções

- **Next.js 16** com `cacheComponents` e `partialPrefetching` ligados: ler `AGENTS.md` e a doc em `node_modules/next/dist/docs/` antes de usar APIs do Next. Leituras de cookies/sessão e `usePathname` ficam dentro de `<Suspense>`. Middleware agora é `proxy.ts`. Não passar componentes/funções (ex.: ícones) de Server para Client Components.
- `npm run typecheck` (gera os tipos de rota e roda `tsc`) e `npm run lint`.
- Dev local na porta **3010** (`npm run dev` → http://localhost:3010). As portas 3000 (Grafana) e 3001 estão ocupadas nesta máquina. Nas Redirect URLs do Supabase, usar `http://localhost:3010/**`.

- Componentes de servidor por padrão; client só quando precisar de interatividade.
- Server Actions ou route handlers para mutações; validar entrada com zod.
- Código e nomes de variáveis em inglês; textos da interface em português.
- Nome da página "Nova Anamnese" com as duas iniciais maiúsculas em toda a interface (menu, botão do topo, breadcrumb, título).
- Rodar lint e typecheck antes de considerar uma etapa concluída.

## Produção

- App em https://prontus-med.vercel.app (o endereço antigo https://anamnese-padronizada.vercel.app continua ativo; projeto Vercel `anamnese-padronizada`, funções em `iad1`). Push na `main` publica sozinho.
- No Supabase: Site URL = domínio da Vercel; Redirect URLs com o domínio da Vercel e `http://localhost:3010/**`; **Confirm email** ligado.
- Se o domínio mudar (ex.: domínio próprio), atualizar Site URL e Redirect URLs no Supabase.
- Nova variável de ambiente: adicionar no `.env.local`, no `.env.example` e na Vercel.
