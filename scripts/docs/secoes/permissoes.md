O controle de acesso é granular por operação, não por tela. Isso permite, por
exemplo, que alguém veja despesas sem poder marcá-las como pagas — uma
distinção que a separação por tela não consegue exprimir.

## Como funciona

Cada papel carrega um conjunto de permissões. Sobre ele o administrador pode
fazer ajustes finos por usuário, e o sistema calcula o conjunto **efetivo** no
servidor, uma vez por requisição. A interface nunca decide acesso: ela recebe
o conjunto pronto.

Três camadas guardam o mesmo limite, e as três precisam concordar:

1. **A tela** exige a permissão de visualizar antes de renderizar.
2. **A operação de escrita** exige a permissão específica antes de gravar.
3. **O menu** esconde o que o usuário não pode abrir.

A terceira é conveniência; as duas primeiras é que são segurança. Esconder o
link sem proteger a operação não protege nada.

## Permissão sensível

Permissão marcada como **sensível** envolve dinheiro, exclusão ou configuração
estrutural. Ela aparece destacada na tela de usuários, e a expectativa é que
seja concedida por exceção — não porque o papel "parece" precisar dela.

## Isolamento de dados

Além da permissão, há o **escopo**: uma extensão do Prisma injeta o
identificador do dono em toda consulta de entidade privada, resolvido pelo
cookie da sessão.

A propriedade importante é que ele **falha fechado**: quando não há sessão —
dentro de um cache, num script, num job — o escopo não "libera tudo", ele
retorna vazio. É a escolha certa para um sistema financeiro multiusuário:
mostrar nada é recuperável, mostrar o dado de outra agência não é.
