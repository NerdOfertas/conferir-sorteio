#!/usr/bin/env node
/**
 * Confere um sorteio da vitrine do Bot do Afiliado usando só dados públicos: a lista carimbada da página do
 * sorteio e a rodada do drand usada como semente. Não usa nenhum código do Bot.
 * Node 18 ou mais novo, sem instalar pacote.
 *
 *   node conferir-sorteio.mjs https://nerdofertas.com/sorteio/1
 *   node conferir-sorteio.mjs https://nerdofertas.com/sorteio/1 --numero 2088
 *   node conferir-sorteio.mjs lista.txt --rodada 33849612 --carimbo <sha256> --resultado 2088
 *
 * Sai 0 quando tudo confere, 1 quando algo não confere e 2 quando não deu para conferir (uso ou rede).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** A rede quicknet do drand: https://api.drand.sh/<cadeia>/info mostra estes mesmos valores. */
const DRAND = {
	cadeia: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
	genese: 1_692_803_367,
	periodo: 3,
	espelhos: ['https://api.drand.sh', 'https://api2.drand.sh', 'https://drand.cloudflare.com'],
};

const AJUDA = `Confere um sorteio com a lista pública e a semente do drand.

  node conferir-sorteio.mjs <endereço da página do sorteio> [opções]
  node conferir-sorteio.mjs <arquivo da lista> --rodada <n> [opções]

Opções:
  --numero <n>      diz se o seu número está na lista, com quantas chances, e em que posição saiu
  --quantos <n>     quantas posições da ordem mostrar (padrão: as que a página publicou)
  --rodada <n>      a rodada do drand (com o endereço, é lida da página)
  --carimbo <hex>   o carimbo publicado (com o endereço, é lido da página)
  --resultado <a,b> os números publicados, na ordem (com o endereço, são lidos da página)
  --semente <hex>   o "randomness" da rodada, para conferir sem rede`;

class ErroDeUso extends Error {}

const sha256 = (dado) => createHash('sha256').update(dado).digest();
const milhar = (n) => n.toLocaleString('pt-BR');
const DATA_HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium' });
const horaDaRodada = (rodada) => DRAND.genese + (rodada - 1) * DRAND.periodo;

// ─── entrada ─────────────────────────────────────────────────────────────────────────────

const OPCOES = ['numero', 'quantos', 'rodada', 'carimbo', 'resultado', 'semente'];

function lerArgumentos(argv) {
	const o = { alvo: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--ajuda' || a === '--help' || a === '-h') o.ajuda = true;
		else if (a.startsWith('--')) {
			const nome = a.slice(2);
			if (!OPCOES.includes(nome)) throw new ErroDeUso(`Opção desconhecida: ${a}`);
			if (argv[i + 1] === undefined) throw new ErroDeUso(`Falta o valor de ${a}`);
			o[nome] = argv[++i];
		} else if (o.alvo === null) o.alvo = a;
		else throw new ErroDeUso(`Sobrou um argumento: ${a}`);
	}
	const inteiro = (nome) => {
		if (o[nome] === undefined) return;
		if (!/^\d{1,15}$/.test(o[nome]) || Number(o[nome]) < 1) throw new ErroDeUso(`--${nome} tem que ser um número inteiro, 1 ou mais`);
		o[nome] = Number(o[nome]);
	};
	const hex = (nome) => {
		if (o[nome] === undefined) return;
		o[nome] = o[nome].trim().toLowerCase();
		if (!/^[0-9a-f]{64}$/.test(o[nome])) throw new ErroDeUso(`--${nome} tem que ter 64 caracteres hexadecimais`);
	};
	inteiro('numero');
	inteiro('quantos');
	inteiro('rodada');
	hex('carimbo');
	hex('semente');
	if (o.resultado !== undefined) {
		if (!/^\d+(,\d+)*$/.test(o.resultado)) throw new ErroDeUso('--resultado é a lista dos números publicados, separados por vírgula');
		o.resultado = o.resultado.split(',').map(Number);
	}
	return o;
}

/** O endereço da página do sorteio, com ou sem /lista ou /regulamento no fim. */
function paginaDoSorteio(endereco) {
	const url = new URL(endereco);
	const m = url.pathname.match(/^(.*\/sorteio\/\d+)(?:\/(?:lista|regulamento))?\/?$/);
	if (!m) throw new ErroDeUso('O endereço tem que ser o da página do sorteio, como https://nerdofertas.com/sorteio/1');
	return url.origin + m[1];
}

async function baixar(url) {
	let r;
	try {
		r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
	} catch {
		throw new ErroDeUso(`Sem resposta de ${url}`);
	}
	if (r.status === 404 && url.endsWith('/lista')) throw new ErroDeUso('A lista só aparece depois da apuração: este sorteio ainda não foi apurado (ou não existe).');
	if (!r.ok) throw new ErroDeUso(`${url} respondeu ${r.status}`);
	return Buffer.from(await r.arrayBuffer());
}

/** O que a página do resultado publica: o carimbo, a rodada do drand e os números sorteados, na ordem. */
function lerPagina(html) {
	const rodada = html.match(new RegExp(`${DRAND.cadeia}/public/(\\d+)`))?.[1];
	return {
		carimbo: html.match(/class="carimbo">([0-9a-f]{64})</)?.[1],
		rodada: rodada ? Number(rodada) : undefined,
		resultado: [...html.matchAll(/<td class="n">(\d+)<\/td>/g)].map((m) => Number(m[1])),
	};
}

// ─── a lista e o carimbo ─────────────────────────────────────────────────────────────────

/**
 * A lista fechada: uma linha por pessoa, `numero:comprovante` ou `numero:comprovante:chances`, em ordem de número.
 * O carimbo é o SHA-256 dessas linhas separadas por quebra de linha, sem quebra no fim. BOM, CRLF e quebra de linha
 * sobrando no fim do arquivo (de quem salvou a lista num editor) não entram na conta.
 */
function lerLista(bytes) {
	const texto = bytes
		.toString('utf8')
		.replace(/^﻿/, '')
		.replace(/\r\n/g, '\n')
		.replace(/\n+$/, '');
	const pessoas = [];
	const problemas = [];
	const vistos = new Set();
	let anterior = 0;
	for (const [i, linha] of (texto === '' ? [] : texto.split('\n')).entries()) {
		const m = linha.match(/^(\d+):([A-Za-z0-9_-]+)(?::(\d+))?$/);
		if (!m) {
			problemas.push(`a linha ${i + 1} está fora do formato`);
			continue;
		}
		const p = { numero: Number(m[1]), comprovante: m[2], chances: Math.max(1, Number(m[3] ?? 1)) };
		if (p.numero <= anterior) problemas.push(`a linha ${i + 1} está fora da ordem de número`);
		if (vistos.has(p.comprovante)) problemas.push(`o comprovante da linha ${i + 1} aparece duas vezes`);
		anterior = p.numero;
		vistos.add(p.comprovante);
		pessoas.push(p);
	}
	return { pessoas, problemas, carimbo: sha256(texto).toString('hex') };
}

// ─── a semente ───────────────────────────────────────────────────────────────────────────

/**
 * O `randomness` da rodada, pedido aos três espelhos do drand. Cada resposta só vale se for da rodada pedida e se o
 * randomness for o SHA-256 da assinatura. A assinatura em si (BLS, contra a chave pública da rede) não é conferida
 * aqui: o cliente oficial do drand faz isso.
 */
async function sementeDoDrand(rodada) {
	return Promise.all(
		DRAND.espelhos.map(async (espelho) => {
			try {
				const r = await fetch(`${espelho}/${DRAND.cadeia}/public/${rodada}`, { signal: AbortSignal.timeout(10_000) });
				if (!r.ok) return { espelho, erro: `respondeu ${r.status}` };
				const j = await r.json();
				const semente = String(j.randomness ?? '');
				const assinatura = String(j.signature ?? '');
				if (j.round !== rodada || !/^[0-9a-f]{64}$/.test(semente) || !/^(?:[0-9a-f]{2})+$/.test(assinatura)) return { espelho, erro: 'resposta fora do formato' };
				if (sha256(Buffer.from(assinatura, 'hex')).toString('hex') !== semente) return { espelho, erro: 'o randomness não é o SHA-256 da assinatura' };
				return { espelho, semente };
			} catch {
				return { espelho, erro: 'sem resposta' };
			}
		}),
	);
}

// ─── o sorteio ───────────────────────────────────────────────────────────────────────────

/**
 * A ordem do sorteio, uma pessoa por vez.
 * - A fila: cada linha da lista entra tantas vezes seguidas quantas forem as chances (os bilhetes).
 * - Os números: o SHA-256 do texto "carimbo:semente:k" (k = 0, 1, 2…) dá 8 números de 32 bits, lidos de 4 em 4
 *   bytes, do mais significativo para o menos, e usados na ordem.
 * - Para cada posição i, com n = bilhetes que sobraram: tira o próximo número x; se x for igual ou maior que o maior
 *   múltiplo de n até 2³², descarta e tira outro (sem isso os primeiros bilhetes teriam vantagem); senão, troca o
 *   bilhete da posição i com o da posição i + (x mod n). O que ficou na posição i é o sorteado.
 * - Se a pessoa desse bilhete já saiu, ele é pulado.
 */
function* ordemDoSorteio(pessoas, carimbo, semente) {
	const fila = [];
	for (const p of pessoas) for (let c = 0; c < p.chances; c++) fila.push(p);
	let k = 0;
	let bloco = null;
	let lidos = 8;
	const proximo = () => {
		if (lidos === 8) {
			bloco = sha256(`${carimbo}:${semente}:${k++}`);
			lidos = 0;
		}
		return bloco.readUInt32BE(4 * lidos++);
	};
	const saiu = new Set();
	for (let i = 0; i < fila.length; i++) {
		const n = fila.length - i;
		const teto = Math.floor(2 ** 32 / n) * n;
		let x;
		do x = proximo();
		while (x >= teto);
		const j = i + (x % n);
		[fila[i], fila[j]] = [fila[j], fila[i]];
		const p = fila[i];
		if (saiu.has(p.comprovante)) continue;
		saiu.add(p.comprovante);
		yield p;
	}
}

// ─── a conferência ───────────────────────────────────────────────────────────────────────

async function conferir(o) {
	const linhas = [];
	const diz = (t = '') => linhas.push(t);
	let confere = true;
	const falhou = (t) => {
		confere = false;
		diz(`   NÃO CONFERE: ${t}`);
	};

	let bytes;
	let publicado = { carimbo: o.carimbo, rodada: o.rodada, resultado: o.resultado ?? [] };
	if (/^https?:\/\//i.test(o.alvo)) {
		const pagina = paginaDoSorteio(o.alvo);
		diz(`Sorteio: ${pagina}`);
		bytes = await baixar(`${pagina}/lista`);
		const lido = lerPagina((await baixar(pagina)).toString('utf8'));
		publicado = {
			carimbo: o.carimbo ?? lido.carimbo,
			rodada: o.rodada ?? lido.rodada,
			resultado: o.resultado ?? lido.resultado,
		};
	} else {
		try {
			bytes = readFileSync(o.alvo);
		} catch {
			throw new ErroDeUso(`Não consegui abrir o arquivo ${o.alvo}`);
		}
		diz(`Lista: ${o.alvo}`);
	}
	if (!publicado.rodada) throw new ErroDeUso('Falta a rodada do drand: passe --rodada <n> (está no resultado e na seção 6 do regulamento).');

	// 1. A lista é a que foi carimbada?
	const { pessoas, problemas, carimbo } = lerLista(bytes);
	const bilhetes = pessoas.reduce((n, p) => n + p.chances, 0);
	diz();
	diz('1. Lista');
	diz(`   ${milhar(pessoas.length)} pessoas, ${milhar(bilhetes)} bilhetes`);
	diz(`   SHA-256 da lista:  ${carimbo}`);
	for (const p of problemas.slice(0, 5)) falhou(p);
	if (problemas.length > 5) diz(`   (e mais ${problemas.length - 5} problemas na lista)`);
	if (!publicado.carimbo) diz('   Sem o carimbo publicado para comparar: passe --carimbo <hex> (está no resultado do sorteio).');
	else {
		diz(`   Carimbo publicado: ${publicado.carimbo}`);
		if (publicado.carimbo === carimbo) diz('   OK: a lista é a que foi carimbada.');
		else falhou('a lista não é a que foi carimbada.');
	}

	// 2. A semente é a da rodada anunciada?
	diz();
	diz('2. Semente');
	diz(`   Rodada ${publicado.rodada} do drand (quicknet), que saiu em ${DATA_HORA.format(new Date(horaDaRodada(publicado.rodada) * 1000))}, horário de Brasília`);
	let semente = o.semente;
	if (semente) diz(`   randomness: ${semente} (informado por você, não foi buscado no drand)`);
	else {
		const respostas = await sementeDoDrand(publicado.rodada);
		const boas = respostas.filter((r) => r.semente);
		const valores = new Set(boas.map((r) => r.semente));
		for (const r of respostas.filter((r) => r.erro)) diz(`   ${r.espelho}: ${r.erro}`);
		if (!boas.length) {
			if (horaDaRodada(publicado.rodada) * 1000 > Date.now()) throw new ErroDeUso('A rodada ainda não saiu: o sorteio ainda não foi apurado.');
			throw new ErroDeUso('Nenhum espelho do drand respondeu. Tente de novo em alguns minutos.');
		}
		if (valores.size > 1) {
			falhou('os espelhos do drand deram valores diferentes para a mesma rodada.');
			return { linhas, confere };
		}
		semente = boas[0].semente;
		diz(`   randomness: ${semente}`);
		diz(`   OK: ${boas.length} de ${respostas.length} espelhos responderam com esse valor, e ele é o SHA-256 da assinatura.`);
	}

	// 3. A conta dá o resultado publicado?
	const ordem = [];
	const mostrar = o.quantos ?? Math.max(publicado.resultado.length, 1);
	const ate = Math.max(mostrar, publicado.resultado.length);
	let minha = null;
	for (const p of ordemDoSorteio(pessoas, carimbo, semente)) {
		ordem.push(p);
		if (o.numero && p.numero === o.numero) minha = ordem.length;
		if (ordem.length >= ate && (!o.numero || minha)) break;
	}
	diz();
	diz('3. Ordem sorteada');
	if (!ordem.length) diz('   A lista está vazia: ninguém participou.');
	for (const [i, p] of ordem.slice(0, mostrar).entries()) diz(`   ${String(i + 1).padStart(2)}º  nº ${p.numero}  (comprovante ${p.comprovante}, ${p.chances} ${p.chances > 1 ? 'chances' : 'chance'})`);
	if (!publicado.resultado.length) diz('   Sem o resultado publicado para comparar: passe --resultado <números, na ordem>.');
	else {
		const refeito = ordem.slice(0, publicado.resultado.length).map((p) => p.numero);
		if (refeito.join() === publicado.resultado.join()) diz(`   OK: igual ao resultado publicado (${publicado.resultado.join(', ')}).`);
		else falhou(`o resultado publicado é ${publicado.resultado.join(', ')} e a conta dá ${refeito.join(', ')}.`);
	}

	if (o.numero) {
		const eu = pessoas.find((p) => p.numero === o.numero);
		diz();
		diz('Seu número');
		if (!eu) diz(`   O nº ${o.numero} não está na lista (quem saiu do sorteio antes do fim não concorre).`);
		else {
			diz(`   O nº ${eu.numero} está na lista, com ${eu.chances} ${eu.chances > 1 ? 'chances' : 'chance'} (comprovante ${eu.comprovante}).`);
			diz(`   Saiu na ${milhar(minha)}ª posição de ${milhar(pessoas.length)}.`);
		}
	}

	diz();
	diz(confere ? 'Resultado: confere.' : 'Resultado: NÃO CONFERE.');
	return { linhas, confere };
}

// Sem process.exit(): com a saída num pipe (| less, | grep), ele cortaria o texto antes de terminar de escrever.
try {
	const o = lerArgumentos(process.argv.slice(2));
	if (o.ajuda || !o.alvo) {
		console.log(AJUDA);
		process.exitCode = o.ajuda ? 0 : 2;
	} else {
		const { linhas, confere } = await conferir(o);
		console.log(linhas.join('\n'));
		process.exitCode = confere ? 0 : 1;
	}
} catch (e) {
	if (!(e instanceof ErroDeUso)) throw e;
	console.error(e.message);
	process.exitCode = 2;
}
