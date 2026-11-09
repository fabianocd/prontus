# Política de segurança

O Prontus lida com anamneses, que são dados de saúde. Se você encontrou uma vulnerabilidade, obrigado por avisar de forma responsável.

## Como reportar

**Não abra uma issue pública.** Use o canal privado do GitHub:

1. Acesse a aba **Security and quality** deste repositório.
2. Clique em **Report a vulnerability** ([link direto](https://github.com/fabianocd/prontus/security/advisories/new)).

Inclua, se possível:

- o que é afetado (página, rota ou arquivo);
- os passos para reproduzir;
- o impacto que você imagina (ex.: ler dados de outra conta).

É um projeto pessoal, mantido por uma pessoa: a resposta é feita assim que possível, normalmente em poucos dias. Você recebe um retorno quando o problema for confirmado e quando a correção for publicada.

## Escopo

- O código deste repositório.
- O app em produção: https://prontus-med.vercel.app.

Ao testar, por favor:

- use **apenas a sua própria conta** (crie uma de teste) e nunca acesse, altere ou apague dados de outras pessoas;
- não faça testes de negação de serviço (DoS), carga massiva ou spam de cadastro e e-mails;
- não use dados reais de pacientes.

Só a versão atual (branch `main`, publicada em produção) recebe correções.

## Medidas de segurança adotadas

**Acesso aos dados**

- Login com e-mail e senha pelo Supabase Auth, com confirmação de e-mail.
- A sessão é validada no servidor em toda operação; o redirecionamento do navegador não é a proteção principal.
- **Row Level Security (RLS) em todas as tabelas**: cada pessoa só lê e altera os próprios registros, mesmo acessando a API do banco diretamente.
- Chaves estrangeiras compostas `(id, user_id)`: não é possível ligar um registro a dados de outra conta.
- Arquivos em bucket **privado**, com acesso restrito à pasta da própria conta e leitura por links assinados e temporários.

**Servidor e entradas**

- Chaves da IA e do Supabase com privilégio administrativo ficam só no servidor, nunca no navegador.
- Toda entrada é validada com zod no servidor, inclusive a resposta da IA antes de ser usada.
- Redirecionamentos depois do login só aceitam caminhos internos do próprio app.
- Leitura de fichas com IA limitada por conta, para que ninguém esgote o serviço para os demais.

**Privacidade (LGPD)**

- O paciente é identificado só por iniciais ou código (o formulário orienta isso); o app não tem campos de CPF, endereço ou contato.
- Apenas a ficha **em branco** é enviada à IA, nunca uma anamnese preenchida.
- Excluir a conta apaga todos os dados e arquivos da pessoa.

**Repositório**

- Secret scanning com push protection (bloqueia o envio de chaves para o código).
- Dependabot para alertas e correções de dependências vulneráveis.
- CI com lint e typecheck em todo pull request.
- Nenhuma chave, dado de paciente ou material de terceiros é versionado.
