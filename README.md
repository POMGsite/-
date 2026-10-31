# Site institucional — Partido Operalista de Minas Gerais (P.O.M.G.)

Site público + painel administrativo, funcionando de ponta a ponta. Sem dependências de terceiros em tempo de execução além de React e `tsx`.

## Escolhas técnicas

| Necessidade | Escolha | Por quê |
|---|---|---|
| Linguagem | TypeScript (strict) | Segurança de tipos, fácil manutenção |
| Interface | React 19 renderizado no servidor (SSR) | Componentes reutilizáveis; páginas completas para SEO e celulares fracos; funciona sem JavaScript no navegador |
| Servidor | Node 22 (`node:http`), roteador próprio | Superfície de ataque pequena |
| Banco | SQLite embutido (`node:sqlite`) | Zero instalação; arquivo único; suficiente para um site institucional; backup = copiar `data/pomg.db` |
| Estilo | CSS próprio (`public/css`), cores e tipografia por variáveis | Sem fontes nem scripts externos (privacidade e CSP estrita) |
| Senhas | scrypt com sal | Padrão do Node, sem dependências |

**Desvio em relação ao pedido original:** Next.js, Tailwind e Prisma não puderam ser instalados no ambiente em que o site foi construído (o acesso ao registro npm estava bloqueado). Por isso o projeto usa React + TypeScript sem Next/Tailwind. Tudo foi construído e testado aqui. Os componentes em `src/views/` são React puro e a camada de dados (`src/server/db.ts`) é independente, o que facilita migrar para Next.js depois.

## Executar no seu computador

Requisito: **Node 22.5 ou superior**.

```bash
npm install
npm run create-admin        # cria o primeiro administrador (pede e-mail e senha de 12+ caracteres)
npm run dev                 # site: http://localhost:3000   painel: http://localhost:3000/admin
```

Testes e verificação de tipos:

```bash
npm test          # 47 testes de integração (login, CSRF, permissões, uploads, contato, publicação...)
npm run typecheck
```

Depois do `npm install`, o arquivo `src/types/shim.d.ts` não é mais necessário (o `@types/react` o substitui) e pode ser apagado.

## Publicar (produção)

1. Um servidor Linux (VPS) com Node 22.5+ e um domínio apontando para ele.
2. Copie o projeto, rode `npm install --omit=dev` e `npm run create-admin`.
3. Configure as variáveis de `.env.example` (principalmente `SITE_URL`, `TRUST_PROXY=1`, `HOST=127.0.0.1`).
4. Rode com `npm start` sob um gerenciador (systemd, pm2), atrás de um proxy com **HTTPS** (Caddy ou Nginx + Let's Encrypt).

Exemplo Caddy (emite e renova o certificado sozinho):

```
www.seudominio.com.br {
    request_body { max_size 12MB }
    reverse_proxy 127.0.0.1:3000
}
```

Exemplo systemd (`/etc/systemd/system/pomg.service`):

```
[Service]
WorkingDirectory=/srv/pomg-site
EnvironmentFile=/srv/pomg-site/.env
ExecStart=/usr/bin/node --no-warnings --import tsx src/server/index.ts
Restart=always
User=pomg
```

**Backups:** copie periodicamente `data/pomg.db` e a pasta `uploads/`.

## Publicar em uma hospedagem (Render, Railway, Fly.io)

O GitHub Pages **não serve** para este site (só hospeda arquivos estáticos; aqui há servidor, painel e banco). O GitHub entra apenas como cofre do código, e a hospedagem roda o site a partir dele.

1. **Prepare o código no seu computador** (uma vez): `npm install` (isso gera o `package-lock.json`; mantenha-o no repositório).
2. **Suba para um repositório privado no GitHub**: `git init`, `git add .`, `git commit -m "Site P.O.M.G."`, crie o repositório em github.com e siga as instruções de `git remote add` / `git push`. O `.gitignore` já impede o envio de banco, uploads e `.env`.
3. **No Render** (render.com): *New → Blueprint*, escolha o repositório. O arquivo `render.yaml` cria o serviço com um **disco persistente** em `/data` (guarda banco e uploads; exige plano pago do Render. Sem disco, tudo some a cada reinício).
4. **Preencha as variáveis** que o Render pedir:
   - `SITE_URL`: o endereço final, ex.: `https://www.seudominio.com.br`
   - `ADMIN_EMAIL` e `ADMIN_PASSWORD`: criam o primeiro administrador no primeiro start (senha com 12+ caracteres, letras e números). Só funciona se ainda não houver nenhum usuário.
5. **Entre em `/admin`**, vá em *Minha conta*, troque a senha e **apague a variável `ADMIN_PASSWORD`** no painel do Render.
6. **Domínio próprio:** em *Settings → Custom Domains* do serviço. O HTTPS é emitido automaticamente.

Railway e Fly.io funcionam com o mesmo `Dockerfile`: crie um volume montado em `/data` e defina `SITE_URL` (e `ADMIN_EMAIL`/`ADMIN_PASSWORD` no primeiro acesso). O Render, o Railway e o Fly já informam a porta e fazem o HTTPS; o `Dockerfile` já define `TRUST_PROXY=1`.

> O `Dockerfile` e o `render.yaml` foram escritos mas **não puderam ser executados no ambiente de construção** (sem acesso ao Docker e ao npm). A aplicação em si foi testada (40 testes); se o primeiro deploy falhar, o log de build do Render mostrará o motivo, e ele deve ser corrigido por ali.

## Versão estática grátis (GitHub Pages, Cloudflare Pages, Netlify)

Para hospedar **sem pagar**, o comando `npm run export` transforma o site em arquivos estáticos (a própria aplicação é "visitada" e cada página é gravada, então o resultado é idêntico). **O que muda na versão estática:** não há painel administrativo, login nem formulário de contato (a página de contato mostra e-mail e redes oficiais) e a Política de Privacidade é trocada por uma versão que descreve um site sem formulários. Para alterar conteúdo, você edita no painel **no seu computador**, gera de novo e sobe os arquivos.

1. Instale o **Node 22.5+** (nodejs.org). Na pasta do projeto: `npm install`, `npm run create-admin` e `npm run dev`.
2. Abra `http://localhost:3000/admin` e preencha tudo: textos, princípios, dirigentes (com autorização), links, documentos, notícias, símbolo oficial. Esse conteúdo fica no arquivo `data/pomg.db` e nas imagens em `uploads/`: **faça backup dessas duas coisas**, pois elas não vão para o GitHub.
3. No GitHub, crie um repositório (ex.: `pomg-site`). Em conta gratuita, o repositório do Pages precisa ser **público**. Isso é seguro: o banco, as senhas e os envios ficam fora do repositório (`.gitignore`); só vão o código e o site já gerado.
4. Gere o site, informando o endereço final:

   ```bash
   npm run export -- --site-url https://SEU-USUARIO.github.io/pomg-site
   ```

   Isso cria a pasta `docs/`. O comando avisa quantas páginas ainda mostram “A informar”.
5. Envie para o GitHub: `git init`, `git add .`, `git commit -m "Site"`, `git branch -M main`, `git remote add origin <endereço do repositório>`, `git push -u origin main`.
6. No GitHub: *Settings → Pages → Build and deployment → Deploy from a branch → Branch `main`, pasta `/docs` → Save*. Em 1 a 2 minutos o site abre no endereço do passo 4.
7. **Domínio próprio** (ex.: `www.partido.org.br`): gere com `--site-url https://www.partido.org.br --domain www.partido.org.br`, e em *Settings → Pages → Custom domain* informe o domínio (o HTTPS é automático). No site onde o domínio foi registrado, crie um registro DNS `CNAME` de `www` para `SEU-USUARIO.github.io`.
8. **Para atualizar:** altere no painel local, rode o `npm run export` de novo (com o mesmo `--site-url`), depois `git add .`, `git commit -m "Atualização"` e `git push`.

Cloudflare Pages e Netlify aceitam a mesma pasta `docs/` (arraste a pasta no painel deles; use o endereço final do site em `--site-url`).

## Como administrar o site

Entre em `/admin`. Há dois papéis:

- **Administrador:** tudo — textos do site, princípios, dirigentes, links e redes, mensagens, usuários, símbolo oficial, exclusões, registro de atividade.
- **Editor:** cria e edita publicações e envia documentos e imagens. Não exclui nem altera textos institucionais.

Onde ainda não há texto aprovado, o site mostra **“A informar”** em vez de inventar conteúdo.

### Símbolo oficial

O símbolo **não foi redesenhado**. Enquanto não houver o arquivo original, o cabeçalho mostra só o nome, e o triângulo concêntrico da página inicial é apenas um elemento decorativo. Para usar o símbolo: Admin → Imagens → enviar o PNG/JPG/WEBP original → “Usar como símbolo”. Ele passa a aparecer no cabeçalho e na página inicial.

## Segurança (implementado e testado)

- Senhas com scrypt; mensagem de erro igual para e-mail inexistente e senha errada; conta bloqueada por 15 min após 5 erros; limite por IP no login.
- Sessão em cookie `HttpOnly`, `SameSite=Lax`, `Secure` em HTTPS; guardada no banco só como hash; expira em 8 h; encerrada ao desativar o usuário ou trocar a senha.
- Proteção CSRF (token por sessão + verificação de origem) em todas as ações do painel.
- Permissões por papel verificadas no servidor.
- Cabeçalhos: CSP restrita (sem scripts nem estilos inline), HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy.
- Textos editáveis viram elementos escapados (nunca HTML cru): sem XSS; links `javascript:` são descartados.
- Uploads: tipo decidido pelo conteúdo do arquivo (JPG/PNG/WEBP/PDF); SVG, HTML e executáveis recusados; nome aleatório no disco; limite de 10 MB; fora da pasta pública.
- Contato: validação no navegador e no servidor, campo-armadilha, token com horário, limite de 8 envios por 15 min por IP, consentimento obrigatório.
- Nenhuma credencial no código nem senha padrão: o administrador é criado pelo comando `create-admin`.

## LGPD

- Coleta mínima: só o que o visitante digita no formulário; IP guardado apenas como hash.
- Sem cookies para visitantes, sem rastreadores, sem recursos de terceiros.
- Mensagens apagadas automaticamente após 12 meses.
- Nomes e fotos de dirigentes só ficam públicos com autorização marcada por pessoa.
- A página `/privacidade` descreve esse comportamento. **Falta** a direção informar o controlador dos dados e o canal de privacidade (Admin → Textos do site).

## Pendências que dependem da direção do partido

Arquivo do símbolo oficial, texto da página inicial, história/fundação/origem/identidade, texto dos cinco princípios, estrutura e dirigentes (com autorização), e-mail/telefone/endereço, links das redes, estatuto e demais documentos, identificação do controlador de dados.

## Estrutura

```
src/server/   servidor, rotas, banco, segurança, uploads, export estático
src/views/    componentes React (páginas públicas e painel)
public/       CSS e JS estáticos
data/         banco SQLite (não versionado)
uploads/      imagens e documentos enviados (não versionado)
tests/        testes de integração
```
