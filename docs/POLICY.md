# Política de sensibilidade

Regra geral: o Cosmo age com autonomia total, **exceto** quando a ação se
encaixa em uma das categorias sensíveis abaixo — nesse caso, ele monta a ação,
mas não a executa até o usuário aprovar explicitamente pelo app.

Esta lista é a fonte da verdade em português; a implementação equivalente em
código está em `backend/src/policy/sensitivity.ts` — as duas devem ser
mantidas em sincronia.

## Categorias que exigem aprovação

- **Dinheiro**: assinaturas, compras, pagamentos, transferências, doações,
  qualquer ação que envolva gastar ou mover dinheiro.
- **Exclusão permanente**: apagar contas, apagar dados que não têm lixeira/
  desfazer, resetar dispositivo.
- **Segurança da conta**: trocar senha, desativar autenticação em duas
  etapas, revogar acesso, alterar e-mail/telefone de recuperação.
- **Comunicação irreversível para terceiros**: enviar mensagem/e-mail para um
  contato pela primeira vez, publicar em rede social, responder
  publicamente.
- **Instalação/remoção de apps** e mudanças de permissões do sistema.

Tudo que não se encaixa nessas categorias — abrir apps, criar lembretes e
eventos, pesquisar, tocar música, ajustar volume/brilho, controlar
dispositivos HomeKit já pareados, ler notificações, etc. — é autônomo.

## Zona cinzenta

Ações ambíguas (ex.: "manda mensagem pro João" quando não está claro se é a
primeira vez) devem ser tratadas como sensíveis até prova em contrário — o
custo de uma aprovação extra é menor que o de uma ação irreversível
indesejada.
