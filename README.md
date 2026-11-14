# Telão

Chat, canais de voz e compartilhamento de tela em salas com código, estilo Discord.
Funciona direto no navegador. O servidor (Node.js) entrega a página, junta as pessoas em salas,
repassa os sinais das chamadas (WebRTC) e guarda mensagens, fotos, banners e emojis.

## Recursos
- Salas com código e link de convite, e um canal de texto e de voz por sala
- Chamada de voz e compartilhamento de tela com áudio
- Chat com respostas, reações, edição, exclusão, formatação (`**negrito**`, `*itálico*`, `` `código` ``, `~~riscado~~`, `||spoiler||`), @menções, "está digitando" mensagens diretas (DM), aba de emojis (padrão e da sala) e envio de imagens e GIFs
- Perfil: foto e banner (GIF animado incluído), efeito de nome, decoração de avatar, cor, status personalizado e temas
- Emojis personalizados por sala (favoritos, servidor no topo do painel e autocompletar com `:`), figurinhas criadas por você e GIFs animados
- Cargos com cor e permissões, atribuição de cargos, criação de canais de texto e de voz, e configurações da sala
- Perfil grande com banner personalizável (cores, ângulo, posição, efeitos), pronomes, emblemas e forma do avatar
- A Capri entra na sua call e escreve no chat: cumprimenta quem chega, comenta transmissões e **entra no assunto quando entende** (com IA; sem IA ela reage a palavras-chave). Comandos: `/entrar`, `/sair`, `/falar`
- Personalidade, notas sobre você (`/notas`, `/anotar`, `/esquecer`), memória do histórico do chat, apelido (`/apelido`) e tamanho das respostas (`/tamanho`), adaptados do projeto Capri de Lachy (veja Créditos)
- Layout fluido: no celular o menu e a lista de membros viram gavetas; no computador a lista de membros recolhe
- Login opcional com Discord e Google (aparece só se você configurar, veja abaixo)
- Transmissão com tela cheia ao clicar; os participantes ficam ao lado, nunca sobre a imagem
- **Capri**, a assistente da sala: mais de 30 comandos (`/ajuda`), IA, economia de eddies, enquetes, lembretes e um retrato dela flutuando na tela
- **Arcade da Capri** (`/jogos`): Jogo da Velha, Breach Protocol, Snake e Digitação, com placar por sala

## Rodar no seu computador
```bash
npm install
npm start
```
Abra http://localhost:3000. Microfone e compartilhamento de tela só funcionam em `localhost` ou em HTTPS.

## Colocar no GitHub
```bash
git init
git add .
git commit -m "Telão"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/telao.git
git push -u origin main
```

## Publicar no Render
1. No Render, clique em **New +** e depois **Web Service**, e conecte o repositório do GitHub.
   (Ou use **New + > Blueprint**: o arquivo `render.yaml` já tem tudo configurado.)
2. Preencha:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/healthz`
3. Clique em **Create Web Service**. Quando terminar, o Render dá um endereço `https://...onrender.com`.
   Mande esse endereço (ou o link de convite de uma sala) para os amigos.

### Pontos de atenção no plano gratuito
- **O serviço dorme** depois de uns 15 minutos sem acesso, e o primeiro acesso demora cerca de um minuto para acordar.
- **O disco é temporário.** Quando o serviço reinicia ou dorme, mensagens, fotos e salas criadas são apagadas.
  Para guardar tudo, use um plano pago com **Disk** (veja o bloco comentado no `render.yaml`):
  monte o disco em `/var/data` e defina a variável `DATA_DIR=/var/data`.
- Cada pessoa continua com as salas salvas no próprio navegador, mas o conteúdo delas fica no servidor.

## Login com Discord e Google (opcional)
Os botões **Entrar com Discord** e **Entrar com Google** só aparecem se você configurar o provedor. Sem as variáveis abaixo, nada é mostrado.
Quem entra mantém o mesmo perfil em qualquer aparelho: o nome e a foto da conta viram o perfil, e o identificador fica fixo e ligado à conta.

**Discord**
1. Abra https://discord.com/developers/applications e crie um aplicativo (New Application).
2. Em **OAuth2**, copie o *Client ID* e o *Client Secret* e, em **Redirects**, adicione `https://SEU-APP.onrender.com/auth/discord/callback`.
3. No Render, em **Environment**, crie `DISCORD_CLIENT_ID` e `DISCORD_CLIENT_SECRET`.

**Google**
1. Abra https://console.cloud.google.com/apis/credentials, configure a tela de consentimento e crie um **ID do cliente OAuth** do tipo *Aplicativo da Web*.
2. Em **URIs de redirecionamento autorizados**, adicione `https://SEU-APP.onrender.com/auth/google/callback`.
3. No Render, crie `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.

Depois salve e faça o deploy de novo. O endereço do site é detectado sozinho; se usar domínio próprio, defina `BASE_URL` (ex.: `https://meusite.com`).
O servidor só lê o nome e a foto públicos da conta (escopos `identify` e `openid profile`). Os dados da sessão ficam na memória do servidor (reiniciar desconecta todo mundo, a não ser que você defina `SESSION_SECRET`).

## Ligar a IA da Capri
A IA da Capri usa o **Gemini 3.8 Flash** (`gemini-3.8-flash`) pela API do Google. A chave **nunca** vai no código nem no GitHub: ela fica só como variável secreta no servidor.

1. Crie uma chave em https://aistudio.google.com/apikey
2. No Render, abra o serviço, vá em **Environment** e adicione `GEMINI_API_KEY` com o valor da chave.
3. Clique em **Save, rebuild and deploy** (ou **Manual Deploy**).

O `/resumir` usa o nível `medium`. O Gemini 3.8 cobra os tokens de raciocínio como saída, então o custo sobe se você aumentar o nível.

Sem a chave, tudo funciona, só a IA (`/capri`, `@capri`, `/resumir`, `/traduzir`...) responde que está fora do ar.
Para rodar no seu computador: `GEMINI_API_KEY=sua-chave npm start`.

Atenção:
- **Nunca** cole a chave em arquivos do projeto, no chat, em prints ou no GitHub. Se ela vazar, apague e crie outra no painel do Google.
- O texto dos pedidos e as últimas mensagens do canal são enviados ao Google para gerar a resposta.
- O servidor limita a 10 pedidos de IA por minuto por pessoa e 60 por minuto no total, para não estourar sua cota.

## Variáveis de ambiente (opcionais)
| Variável | Para que serve | Padrão |
|---|---|---|
| `PORT` | Porta do servidor (o Render define sozinho) | 3000 |
| `DATA_DIR` | Pasta onde o banco (`db.json`) é salvo | `./data` |
| `MAX_DB_MB` | Tamanho máximo do banco | 200 |
| `MAX_ROOM` | Máximo de pessoas por sala | 25 |
| `GEMINI_API_KEY` | Chave da IA da Capri (segredo) | desligada |
| `GEMINI_MODEL` | Modelo do Gemini usado pela Capri | gemini-3.8-flash |
| `GEMINI_THINKING` | Nível de raciocínio nos pedidos rápidos: `low`, `medium` ou `high` (mais alto = mais lento e mais caro) | low |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Login com Discord (segredos) | desligado |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Login com Google (segredos) | desligado |
| `SESSION_SECRET` | Assina os cookies de login; mantenha fixo para não derrubar sessões | aleatório a cada início |
| `BASE_URL` | Endereço público do site, se não for o do Render | detectado |
| `ICE_SERVERS` | Lista JSON de servidores STUN/TURN | STUN do Google |

### Se a chamada não conectar para alguém
Algumas redes (celular, empresas) bloqueiam a conexão direta e precisam de um servidor TURN.
Contrate um (Metered, Twilio, Cloudflare Calls ou um coturn próprio) e defina, por exemplo:
```
ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:SEU-TURN:3478","username":"USUARIO","credential":"SENHA"}]
```

## Limitações
- **Cargos e permissões** valem só na interface: quem controla o servidor ou conhece o banco consegue contorná-las. A sala sem dono deixa todos gerenciarem tudo até alguém usar "Assumir a sala".
- **Sem contas nem senha:** o apelido e a foto são só o que cada pessoa escolhe, e quem tem o código entra na sala. Qualquer pessoa na sala pode mexer em mensagens de outras pelo servidor. Use com amigos, não como serviço público.
- **Chamadas em malha:** cada pessoa se conecta a todas as outras, então compartilhar tela para muita gente pesa. Funciona bem com grupos pequenos (até uns 5 ou 6).
- **Imagens e GIFs:** não há limite fixo por arquivo. Imagens comuns são reduzidas automaticamente; GIFs e WebPs animados são guardados como estão, até 8 MB. Tudo fica no banco do servidor (limite `MAX_DB_MB`) e não é apagado sozinho, então muitos GIFs grandes enchem o banco.
- **Mensagens diretas** ficam separadas dos canais na interface, mas não são criptografadas nem protegidas por senha: quem controla o servidor (ou conhece o banco) consegue lê-las.

## Créditos e licença
Parte da Capri (personalidade, notas, memória e saudações) foi adaptada do projeto **Capri**, de Lachy: https://github.com/lachydotmcg/capri-desktop, sob a licença **PolyForm Noncommercial 1.0.0**.
Por isso **este projeto só pode ser usado para fins não comerciais** e deve manter o arquivo `NOTICE.md`. Detalhes e avisos obrigatórios em `NOTICE.md` e, dentro do site, no comando `/creditos`.
Projeto de fã, não oficial.

## Estrutura
```
server.js            servidor HTTP + WebSocket (salas, presença, banco em arquivo JSON) e proxy da IA
public/index.html    a interface
public/telao-net.js  conecta a interface ao servidor
render.yaml          configuração para o Render
NOTICE.md            créditos e avisos de licença da Capri
```
