# Vitoria Finance — app

Aplicativo React Native com Expo para Android e iOS. A interface é nativa e consome a API JSON do VitoriaFinance em `https://vitoriafinance.vh5.xyz/api/v1`.

## Experiência no celular

- Login protegido com token de 30 dias, armazenado no Keychain/Keystore do dispositivo.
- Barra inferior nativa para início, visão do mês, lançamento, cartões e perfil.
- Dashboard financeiro, movimentações mensais, troca de área e cadastro nativo de receitas, despesas e transferências.
- Consulta dos cartões e detalhes de vencimento, limite e conta vinculada.
- Campos e seletores nativos, incluindo seletor de data, estado de carregamento e atualização por gesto.
- A API valida novamente as permissões de workspace e área financeira a cada chamada.

O serviço web segue disponível e continua sendo a fonte única dos dados. A API foi adicionada ao mesmo FastAPI, sem substituir as telas web. O app já não usa WebView. Telas de análise avançada, orçamentos e cadastros administrativos ainda seguem disponíveis pela interface web e podem ser migradas em etapas futuras.

## Requisitos e execução

- Node.js **22.13.0 ou superior** (requisito indicado pelo Expo Doctor/Metro deste projeto).
- npm e Expo Go compatível com SDK 54 para testar no dispositivo.

```powershell
npm install
npm start
```

Leia o QR code com o Expo Go. No Windows, rode no Android:

```powershell
npm run android
```

Por padrão, o app usa `https://vitoriafinance.vh5.xyz/api/v1`. Para testar outro serviço sem alterar o código, crie `.env.local` com `EXPO_PUBLIC_API_BASE_URL=http://<IP-DA-MAQUINA>:8000/api/v1`. Esse arquivo é ignorado pelo Git. A branch `codex/mobile-api` precisa ser implantada no serviço público antes que o app autentique em produção.

## Gerar instaladores

Instale e configure o EAS CLI na conta Expo que fará as compilações. Depois:

```powershell
eas build --profile preview --platform android
eas build --profile production --platform all
```

O perfil `preview` gera um APK interno para validação. O perfil `production` gera os artefatos de distribuição. Identificadores, ícone e versão estão em `app.json`.

## Verificações locais

```powershell
npm run typecheck
npx expo-doctor
```

O Node instalado no ambiente de preparação era 20.14.0, abaixo do requisito atual do projeto; atualize para 22.13.0+ antes de instalar, rodar ou compilar o app.
