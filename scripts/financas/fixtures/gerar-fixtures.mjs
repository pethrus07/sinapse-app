// Gera as respostas FALSAS da API da Pluggy usadas nos testes (scripts/financas/fixtures/pluggy/).
// Formato copiado dos exemplos da referência (docs.pluggy.ai/en/reference). Todo nome, CPF, CNPJ,
// conta e id aqui é inventado. Rodar: node scripts/financas/fixtures/gerar-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const D = join(dirname(fileURLToPath(import.meta.url)), 'pluggy');
mkdirSync(D, { recursive: true });
const w = (f, o) => writeFileSync(join(D, f), JSON.stringify(o, null, 2) + '\n');

export const ITEM = '00000000-0000-4000-8000-000000000001';
export const NU = 'a1111111-0000-4000-8000-000000000001';
export const CARTAO = 'a2222222-0000-4000-8000-000000000002';
export const INTER = 'a3333333-0000-4000-8000-000000000003';

w('itens.json', [ITEM]);
w(`item-${ITEM}.json`, {
  id: ITEM, connector: { id: 200, name: 'MeuPluggy', institutionUrl: 'https://meu.pluggy.ai/' },
  status: 'UPDATED', executionStatus: 'SUCCESS', consentExpiresAt: '2030-04-01T00:00:00.000Z',
  lastUpdatedAt: '2030-03-10T06:00:00.000Z', error: null,
});
const conta = (id, type, subtype, marketingName, number) => ({
  id, type, subtype, number, name: type === 'CREDIT' ? 'Cartão de crédito' : 'Conta corrente', marketingName,
  balance: 1000, itemId: ITEM, taxNumber: '123.456.789-09', owner: 'FULANA DE TESTE DA SILVA', currencyCode: 'BRL',
});
w(`accounts-${ITEM}.json`, {
  page: 1, total: 3, totalPages: 1, results: [
    conta(NU, 'BANK', 'CHECKING_ACCOUNT', 'Nubank', '9999999-1'),
    conta(CARTAO, 'CREDIT', 'CREDIT_CARD', 'Nubank Ultravioleta', '5555 **** **** 4321'),
    conta(INTER, 'BANK', 'CHECKING_ACCOUNT', 'Banco Inter', '88888888-2'),
  ],
});
const pessoa = (name, doc, tipo = 'CPF') => ({
  name, branchNumber: '0001', accountNumber: '12345-6', routingNumber: '260', documentNumber: { type: tipo, value: doc },
});
let k = 0;
const tx = (accountId, type, amount, date, extra = {}) => {
  k++;
  return {
    id: `f${String(k).padStart(7, '0')}-0000-4000-8000-${String(k).padStart(12, '0')}`,
    createdAt: date + 'T10:00:00.000Z', updatedAt: date + 'T10:00:00.000Z', description: 'Transação', descriptionRaw: null,
    currencyCode: 'BRL', amount: type === 'DEBIT' && accountId !== CARTAO ? -amount : amount, amountInAccountCurrency: null,
    date: date + 'T00:00:00.000Z', balance: 0, category: 'Transfers', accountId, providerCode: null, status: 'POSTED',
    type, operationType: null, paymentData: null, providerId: null, ...extra,
  };
};
w(`transactions-${NU}-1.json`, {
  results: [
    tx(NU, 'CREDIT', 2000, '2030-03-06', {
      description: 'Transferência recebida pelo Pix EMPRESA ALFA LTDA 11.222.333/0001-81', operationType: 'PIX',
      paymentData: { payer: pessoa('EMPRESA ALFA LTDA', '11.222.333/0001-81', 'CNPJ'), receiver: pessoa('FULANA DE TESTE DA SILVA', '123.456.789-09'), paymentMethod: 'PIX', reason: null, referenceNumber: '998877665544' },
    }),
    tx(NU, 'CREDIT', 250, '2030-03-03', { description: 'Transferência recebida pelo Pix BELTRANO DE SOUZA', operationType: 'PIX', paymentData: { payer: pessoa('BELTRANO DE SOUZA', '987.654.321-00'), paymentMethod: 'PIX' } }),
    tx(NU, 'CREDIT', 500, '2030-03-08', { description: 'Transferência recebida pelo Pix CICRANO PEREIRA', operationType: 'PIX', paymentData: { payer: pessoa('CICRANO PEREIRA', '111.222.333-44'), paymentMethod: 'PIX' } }),
    tx(NU, 'DEBIT', 312.4, '2030-03-05', { description: 'Pagamento de fatura', category: 'Credit card payment' }),
    tx(NU, 'DEBIT', 1000, '2030-03-06', { description: 'Aplicação RDB', category: 'Investments' }),
    tx(NU, 'DEBIT', 45.9, '2030-03-07', {
      description: 'Transferência enviada pelo Pix PADARIA DO ZE - 12.345.678/0001-99', operationType: 'PIX', category: 'Food and drinks',
      paymentData: { receiver: pessoa('JOSE DA PADARIA', '12.345.678/0001-99', 'CNPJ'), paymentMethod: 'PIX' },
    }),
    tx(NU, 'DEBIT', 89, '2030-03-07', { description: 'IFOOD *RESTAURANTE', category: 'Food delivery' }),
    tx(NU, 'DEBIT', 10, '2030-03-09', { description: 'Compra pendente', status: 'PENDING' }),
    tx(NU, 'DEBIT', 300, '2030-03-09', { description: 'Transferência para FULANA DE TESTE DA SILVA', category: 'Same person transfer' }),
  ],
  next: `?accountId=${NU}&after=2`,
});
w(`transactions-${NU}-2.json`, {
  results: [
    tx(NU, 'CREDIT', 120, '2030-02-28', { description: 'TED recebida FULANO ANTIGO CPF 222.333.444-55 Ag 0001 Conta 12345-6', operationType: 'TED' }),
    tx(NU, 'CREDIT', 75, '2030-01-15', { description: 'Fora do período (antes de --desde)' }),
  ],
  next: null,
});
const cc = (bill) => ({ creditCardMetadata: { installmentNumber: 1, totalInstallments: 1, totalAmount: null, purchaseDate: null, cardNumber: '4321', billId: null, billForecastDate: bill } });
w(`transactions-${CARTAO}-1.json`, {
  results: [
    tx(CARTAO, 'DEBIT', 59.9, '2030-03-01', { description: 'Netflix.com', category: 'Video streaming', merchant: { name: 'NETFLIX', businessName: 'NETFLIX ENTRETENIMENTO BRASIL LTDA', cnpj: '13.590.585/0001-99', category: 'streaming', cnae: '5911199' }, ...cc('2030-04-05') }),
    tx(CARTAO, 'DEBIT', 200, '2030-03-02', { description: 'LOJA FULANO MEI 12345678000199', category: 'Shopping', ...cc('2030-04-05') }),
  ],
  next: null,
});
const bill = (i, due, close, total) => ({
  id: `b000000${i}-0000-4000-8000-00000000000${i}`, dueDate: due + 'T00:00:00', billClosingDate: close + 'T00:00:00', totalAmount: total,
  totalAmountCurrencyCode: 'BRL', minimumPaymentAmount: Math.round(total * 20) / 100, allowsInstallments: true, financeCharges: [], payments: [],
});
w(`bills-${CARTAO}.json`, { page: 1, total: 3, totalPages: 1, results: [bill(1, '2030-02-05', '2030-01-29', 280), bill(2, '2030-03-05', '2030-02-26', 312.4), bill(3, '2030-04-05', '2030-03-29', 259.9)] });
w(`investments-${ITEM}.json`, {
  page: 1, total: 3, totalPages: 1, results: [
    { id: 'c0000001-0000-4000-8000-000000000001', name: 'Caixinha Reserva', code: null, number: '0001-RESERVA', type: 'FIXED_INCOME', subtype: 'CDB', status: 'ACTIVE', balance: 6200, amount: 6200, currencyCode: 'BRL', owner: 'FULANA DE TESTE DA SILVA', institution: { name: 'Nu Pagamentos', number: '260' }, itemId: ITEM, date: '2030-03-10' },
    { id: 'c0000002-0000-4000-8000-000000000002', name: 'CDB Banco Falso 2032', type: 'FIXED_INCOME', subtype: 'CDB', status: 'ACTIVE', balance: 1500, amount: 1500, currencyCode: 'BRL', institution: { name: 'Banco Inter', number: '077' }, itemId: ITEM, dueDate: '2032-01-01T00:00:00', date: '2030-03-10' },
    { id: 'c0000003-0000-4000-8000-000000000003', name: 'CDB resgatado', type: 'FIXED_INCOME', subtype: 'CDB', status: 'TOTAL_WITHDRAWAL', balance: 0, institution: { name: 'Banco Inter' }, itemId: ITEM },
  ],
});
console.log('fixtures em ' + D);
