// node --test
// Roda o conferidor sem rede (a semente vai por --semente) contra o sorteio do PS5 e contra uma lista pequena cuja
// ordem foi calculada pelas funções do próprio Bot.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const aqui = fileURLToPath(new URL('.', import.meta.url));
const script = join(aqui, 'conferir-sorteio.mjs');
const temp = mkdtempSync(join(tmpdir(), 'conferir-sorteio-'));

/** O sorteio do PS5 (nerdofertas.com/sorteio/1, apurado em 10/11/2026). */
const PS5 = {
	lista: join(aqui, 'exemplos', 'sorteio-1', 'lista.txt'),
	rodada: '33849612',
	carimbo: '709e0aabd2578a68b226f280c68dc9a24367207cb00bf5a813e4c373efcb5a0f',
	semente: '8b4f248713a0000ec172ac990d4c2e0b8d1f3e00feb0d332aed73a912a4fa70d',
	resultado: '2088',
};
const doPs5 = (lista = PS5.lista) => [lista, '--rodada', PS5.rodada, '--carimbo', PS5.carimbo, '--semente', PS5.semente, '--resultado', PS5.resultado];

function rodar(...args) {
	const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
	return { codigo: r.status, saida: r.stdout + r.stderr };
}

function arquivo(nome, texto) {
	const caminho = join(temp, nome);
	writeFileSync(caminho, texto);
	return caminho;
}

test('o sorteio do PS5 confere', () => {
	const r = rodar(...doPs5());
	assert.equal(r.codigo, 0, r.saida);
	assert.match(r.saida, /4\.026 pessoas, 4\.307 bilhetes/);
	assert.match(r.saida, /OK: a lista é a que foi carimbada\./);
	assert.match(r.saida, / 1º {2}nº 2088 /);
	assert.match(r.saida, /OK: igual ao resultado publicado \(2088\)\./);
	assert.match(r.saida, /Resultado: confere\./);
});

test('uma linha mexida na lista é acusada', () => {
	const mexida = readFileSync(PS5.lista, 'utf8').replace(/^1:([^:]+):1$/m, '1:$1:2');
	const r = rodar(...doPs5(arquivo('mexida.txt', mexida)));
	assert.equal(r.codigo, 1, r.saida);
	assert.match(r.saida, /NÃO CONFERE: a lista não é a que foi carimbada\./);
});

test('resultado publicado diferente da conta é acusado', () => {
	const r = rodar(PS5.lista, '--rodada', PS5.rodada, '--carimbo', PS5.carimbo, '--semente', PS5.semente, '--resultado', '2089');
	assert.equal(r.codigo, 1, r.saida);
	assert.match(r.saida, /NÃO CONFERE: o resultado publicado é 2089 e a conta dá 2088\./);
});

test('quebra de linha no fim, CRLF e BOM não mudam o carimbo', () => {
	const salva = `﻿${readFileSync(PS5.lista, 'utf8').replace(/\n/g, '\r\n')}\r\n`;
	const r = rodar(...doPs5(arquivo('salva-no-editor.txt', salva)));
	assert.equal(r.codigo, 0, r.saida);
});

test('--numero diz as chances e a posição em que o número saiu', () => {
	const r = rodar(...doPs5(), '--numero', '17');
	assert.equal(r.codigo, 0, r.saida);
	assert.match(r.saida, /O nº 17 está na lista, com 1 chance/);
	assert.match(r.saida, /Saiu na 1\.186ª posição de 4\.026\./);
	assert.match(rodar(...doPs5(), '--numero', '999999').saida, /O nº 999999 não está na lista/);
});

test('lista com chances extras: a ordem inteira é a das funções do Bot', () => {
	// 10 pessoas, 21 bilhetes. A ordem esperada saiu das funções de sorteio do próprio Bot.
	const lista = arquivo('pequena.txt', ['3:aaa:2', '7:bbb:1', '8:ccc:5', '12:ddd:1', '13:eee:3', '20:fff:1', '21:ggg:1', '34:hhh:4', '55:iii:1', '89:jjj:2'].join('\n'));
	const r = rodar(
		lista,
		'--rodada', '1',
		'--semente', 'b5feb1a7f3807fc258ae46f1c0ab8f93cfd904d0fae999d097016e3f1a8e0766',
		'--carimbo', '5b343d52c740657a8e12aafc8c7d1f903658d15d92d268b71d86052d616812c2',
		'--resultado', '7,55,3,12,13,34,8,89,20,21',
	);
	assert.equal(r.codigo, 0, r.saida);
	assert.match(r.saida, /10 pessoas, 21 bilhetes/);
});

test('lista fora do formato ou fora de ordem é acusada', () => {
	const semente = ['--rodada', '1', '--semente', PS5.semente];
	assert.match(rodar(arquivo('torta.txt', '1:aaa:1\ndois:bbb:1'), ...semente).saida, /NÃO CONFERE: a linha 2 está fora do formato/);
	assert.match(rodar(arquivo('desordem.txt', '2:aaa:1\n1:bbb:1'), ...semente).saida, /NÃO CONFERE: a linha 2 está fora da ordem de número/);
	assert.match(rodar(arquivo('repetida.txt', '1:aaa:1\n2:aaa:1'), ...semente).saida, /NÃO CONFERE: o comprovante da linha 2 aparece duas vezes/);
});

test('sem a rodada ou com opção errada, sai 2 e diz o que falta', () => {
	const semRodada = rodar(PS5.lista);
	assert.equal(semRodada.codigo, 2);
	assert.match(semRodada.saida, /Falta a rodada do drand/);
	assert.equal(rodar(PS5.lista, '--carimbo', 'abc').codigo, 2);
	assert.equal(rodar(PS5.lista, '--nada', '1').codigo, 2);
	assert.equal(rodar('https://nerdofertas.com/outra-coisa').codigo, 2);
});
