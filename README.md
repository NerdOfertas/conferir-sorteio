# Conferir sorteio

Passo a passo e código para qualquer pessoa conferir um sorteio do Nerd Ofertas, feito na vitrine do Bot do Afiliado:
se o seu número estava na lista, se a lista publicada é a que foi carimbada e se o ganhador é mesmo o que a conta dá.

O ganhador não é escolhido por ninguém. Ele sai de uma conta com duas entradas públicas: a lista fechada dos
participantes e um número aleatório de uma rede de fora, o [drand](https://drand.love), que só existe depois que as
inscrições fecham.

## Conferir em um comando

Precisa do [Node.js](https://nodejs.org) 18 ou mais novo. Não instala nada além dele.

```sh
node conferir-sorteio.mjs https://nerdofertas.com/sorteio/1
```

O que sai, no sorteio do PS5 (novembro de 2026):

```
Sorteio: https://nerdofertas.com/sorteio/1

1. Lista
   4.026 pessoas, 4.307 bilhetes
   SHA-256 da lista:  709e0aabd2578a68b226f280c68dc9a24367207cb00bf5a813e4c373efcb5a0f
   Carimbo publicado: 709e0aabd2578a68b226f280c68dc9a24367207cb00bf5a813e4c373efcb5a0f
   OK: a lista é a que foi carimbada.

2. Semente
   Rodada 33849612 do drand (quicknet), que saiu em 10/11/2026, 20:10:00, horário de Brasília
   randomness: 8b4f248713a0000ec172ac990d4c2e0b8d1f3e00feb0d332aed73a912a4fa70d
   OK: 3 de 3 espelhos responderam com esse valor, e ele é o SHA-256 da assinatura.

3. Ordem sorteada
    1º  nº 2088  (comprovante qvlMneekTRFH, 1 chance)
   OK: igual ao resultado publicado (2088).

Resultado: confere.
```

O script baixa a lista e lê na página do sorteio o carimbo, a rodada e o resultado publicados. Depois refaz a conta
sozinho, sem nenhum código do Bot.

| Opção | Para quê |
|---|---|
| `--numero 2088` | dizer se o seu número está na lista, com quantas chances, e em que posição ele saiu |
| `--quantos 10` | mostrar mais posições da ordem (as próximas são os suplentes) |
| `--rodada`, `--carimbo`, `--resultado` | informar à mão o que a página publica, quando a lista está num arquivo |
| `--semente` | informar o `randomness` da rodada e conferir sem rede |

O comando termina com código 0 quando tudo confere, 1 quando algo não confere e 2 quando não deu para conferir
(endereço errado, sem rede, sorteio ainda não apurado).

## Conferir na mão, sem o script

Tudo o que você precisa está na página do resultado, na linha abaixo da tabela dos sorteados.

1. **Seu número está na lista.** Abra "ver a lista" (`/sorteio/<id>/lista`) e procure o seu número no começo de uma
   linha. Cada linha é `número:comprovante:chances`. O comprovante é o código que a página mostrou depois da sua
   inscrição.
2. **A lista publicada é a que foi carimbada.** Baixe a lista e calcule o SHA-256 dela. Tem que dar o "Carimbo da
   lista" que a página mostra (maiúsculas e minúsculas não importam).

   ```sh
   # Linux
   curl -s https://nerdofertas.com/sorteio/1/lista | sha256sum
   # macOS
   curl -s https://nerdofertas.com/sorteio/1/lista | shasum -a 256
   ```

   ```powershell
   # Windows (PowerShell)
   curl.exe -s -o lista.txt https://nerdofertas.com/sorteio/1/lista
   Get-FileHash lista.txt -Algorithm SHA256
   ```

3. **A semente é a da rede pública.** O link "rodada … do drand" da página abre a resposta da própria rede. O campo
   `randomness` é a semente. O endereço não é nosso: `https://api.drand.sh/<rede>/public/<rodada>`.
4. **A conta dá o resultado publicado.** É a parte que o script faz. As regras estão logo abaixo, para quem quiser
   refazer em outra linguagem.

## Como o sorteio é feito

O regulamento de cada sorteio traz estas mesmas regras na seção 6.

1. **Lista.** No fim do período, cada pessoa que concorre vira uma linha `número:comprovante:chances`, em ordem de
   número. Sorteio sem chance extra por indicação tem linhas `número:comprovante`. A mesma pessoa conta uma vez só.
2. **Carimbo.** É o SHA-256, em hexadecimal minúsculo, das linhas separadas por quebra de linha (`\n`), sem quebra no
   fim.
3. **Semente.** É o campo `randomness` de uma rodada da rede quicknet do drand, que solta um número a cada 3 segundos.
   A rodada é a do primeiro horário múltiplo de 5 minutos que fica pelo menos 10 minutos depois do fim das inscrições.
   A rodada `r` sai em `1692803367 + (r − 1) × 3` segundos (horário Unix).
4. **Bilhetes.** Os bilhetes ficam numa fila na ordem da lista. Cada linha entra tantas vezes seguidas quantas forem
   as chances.
5. **Números.** O SHA-256 do texto `carimbo:semente:k`, com k = 0, 1, 2…, dá 32 bytes. Cada um vira 8 números de 32
   bits, lidos de 4 em 4 bytes, do byte mais significativo para o menos, e usados na ordem.
6. **Sorteio.** Para cada posição i = 0, 1, 2…, com n = bilhetes − i, tira-se o próximo número x. Se x for igual ou
   maior que o maior múltiplo de n que cabe em 2³², ele é descartado e tira-se outro, para nenhum bilhete ter
   vantagem. Senão, o bilhete da posição i troca de lugar com o da posição i + (x mod n), e o que ficou na posição i
   é o sorteado.
7. **Uma vez por pessoa.** Se a pessoa do bilhete sorteado já saiu antes, o bilhete é pulado.

A ordem que sai daí é a do resultado: primeiro os ganhadores, depois os suplentes. Quem é desclassificado continua
na ordem, e a vaga passa para o próximo.

### Valores para conferir uma reimplementação

Do sorteio do PS5, com a lista de `exemplos/sorteio-1/lista.txt`:

| O quê | Valor |
|---|---|
| Carimbo | `709e0aabd2578a68b226f280c68dc9a24367207cb00bf5a813e4c373efcb5a0f` |
| Rodada do drand | 33849612 |
| Semente | `8b4f248713a0000ec172ac990d4c2e0b8d1f3e00feb0d332aed73a912a4fa70d` |
| SHA-256 de `carimbo:semente:0` | `6353bca9c8fbf8d7e8f420848f888f2131dbc2d6e1ab1ee5f5812e30ba7f0590` |
| Primeiro número (x) | 1666432169 |
| Bilhetes (n) | 4307 |
| Maior múltiplo de n em 2³² | 4294966242 |
| x mod n | 2185 |
| Bilhete da posição 2185, contando do zero | nº 2088, o 1º sorteado |

## Por que ninguém escolhe o ganhador

- A rodada do drand é definida pelo horário de término do sorteio, e o regulamento diz qual é.
- O drand é mantido por várias organizações independentes (a League of Entropy). O número de cada rodada é assinado
  pela rede e ninguém o conhece antes da hora: nenhum operador consegue calculá-lo sozinho.
- A rodada sai pelo menos 10 minutos depois do fim das inscrições, e o sorteio é apurado em seguida, de forma
  automática.
- Qualquer mudança na lista muda o carimbo, e com ele a ordem inteira.

## O que esta conferência não prova

- **Quem está por trás de cada linha.** A lista mostra número, comprovante e chances. Ela não mostra se duas linhas
  são da mesma pessoa, nem se as chances extras dos outros vieram de amigos de verdade. Essa conferência é do
  organizador, que vê os dados de cada inscrição.
- **A hora em que a lista fechou.** O carimbo é publicado junto com o resultado, não antes de a semente sair. O que
  cada participante consegue conferir por conta própria é a própria linha: número, comprovante e chances.
- **A assinatura do drand.** O script confere que o `randomness` é o SHA-256 da assinatura e que os três endereços
  públicos da rede respondem a mesma coisa. Ele não confere a assinatura contra a chave pública da rede. O
  [cliente oficial do drand](https://github.com/drand/drand-client) faz essa conferência.

## Exemplo incluído e testes

`exemplos/sorteio-1/lista.txt` é a lista do sorteio do PS5 (`nerdofertas.com/sorteio/1`, apurado em 10/11/2026), como
a página a publica. Os testes rodam sem rede:

```sh
node --test
```

## Licença

MIT. Veja [LICENSE](LICENSE).
