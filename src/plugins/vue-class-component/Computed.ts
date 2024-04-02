import { ASTConverter, ASTResultKind, ASTTransform, ASTResult, ReferenceKind, ASTResultToComposition } from '../types'
import type ts from 'typescript'
import { copySyntheticComments, getStringAttribute, convertTypeToTypeNode } from '../../utils'

export const convertGetter: ASTConverter<ts.GetAccessorDeclaration> = (node, options) => {
  const tsModule = options.typescript
  const computedName = node.name.getText()

  return {
    tag: 'Computed-getter',
    kind: ASTResultKind.COMPOSITION,
    imports: [{
      named: ['computed'],
      external: (options.compatible) ? '@vue/composition-api' : 'vue'
    }],
    reference: ReferenceKind.VARIABLE,
    attributes: [computedName],
    nodes: [
      copySyntheticComments(
        tsModule,
        tsModule.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          tsModule.createToken(tsModule.SyntaxKind.EqualsGreaterThanToken),
          node.body ?? tsModule.createBlock([])
        ),
        node
      )
    ],
    types: [node.type as any]
  }
}

export const convertSetter: ASTConverter<ts.SetAccessorDeclaration> = (node, options) => {
  const tsModule = options.typescript
  const computedName = node.name.getText()

  return {
    tag: 'Computed-setter',
    kind: ASTResultKind.COMPOSITION,
    imports: [{
      named: ['computed'],
      external: (options.compatible) ? '@vue/composition-api' : 'vue'
    }],
    reference: ReferenceKind.VARIABLE,
    attributes: [computedName],
    nodes: [
      copySyntheticComments(
        tsModule,
        tsModule.createArrowFunction(
          undefined,
          node.typeParameters,
          node.parameters,
          undefined,
          tsModule.createToken(tsModule.SyntaxKind.EqualsGreaterThanToken),
          node.body ?? tsModule.createBlock([])
        ),
        node
      )
    ]
  }
}

interface Results {
  getterASTResults: ASTResultToComposition<ts.Node>[]
  otherASTResults: ASTResult<ts.Node>[]
  syncRelatedASTResults: ASTResultToComposition<ts.Node>[]
  setterASTResults: ASTResult<ts.Node>[]
}
export const mergeComputed: ASTTransform = (astResults: ASTResult<ts.Node>[], options) => {
  const tsModule = options.typescript;
  const {
    getterASTResults,
    otherASTResults,
    setterASTResults,
    syncRelatedASTResults,
  } = astResults.reduce<Results>((acc, el) => {
    if (el.tag === 'Computed-getter') {
      acc.getterASTResults.push(el as ASTResultToComposition<ts.Node>);
    } else if (el.tag === 'Computed-setter') {
      acc.setterASTResults.push(el);
    } else if (el.tag === 'PropSync' || el.tag === 'ModelSync') {
      acc.syncRelatedASTResults.push(el as ASTResultToComposition<ts.Node>);
    } else {
      acc.otherASTResults.push(el);
    }

    return acc;
  }, {
    getterASTResults: [],
    otherASTResults: [],
    setterASTResults: [],
    syncRelatedASTResults: [],
  });

  const computedASTResults: ASTResult<ts.Statement>[] = []

  getterASTResults.forEach((getter) => {
    const getterName = getStringAttribute(getter.attributes, 0);
    const setter = setterASTResults.find((el) => el.attributes.includes(getterName))

    const leadingComments = (setter) ? [] : tsModule.getSyntheticLeadingComments(getter.nodes[0])
    const trailingComments = (setter) ? [] : tsModule.getSyntheticTrailingComments(getter.nodes[0])
    const typeNode = getter.types ? convertTypeToTypeNode(getter.types[0], tsModule) : undefined;

    const resultNode = tsModule.createVariableStatement(
      undefined,
      tsModule.createVariableDeclarationList([
        tsModule.createVariableDeclaration(
          tsModule.createIdentifier(getterName),
          undefined,
          tsModule.createCall(
            tsModule.createIdentifier('computed'),
            typeNode ? [typeNode] : undefined,
            [
              (setter)
                ? tsModule.createObjectLiteral([
                  tsModule.createPropertyAssignment(
                    tsModule.createIdentifier('get'),
                    getter.nodes[0] as ts.Expression
                  ),
                  tsModule.createPropertyAssignment(
                    tsModule.createIdentifier('set'),
                    setter.nodes[0] as ts.Expression
                  )
                ], true)
                : tsModule.setSyntheticTrailingComments(tsModule.setSyntheticLeadingComments(getter.nodes[0], undefined), undefined) as ts.Expression
            ]
          )
        )
      ],
      tsModule.NodeFlags.Const)
    )

    computedASTResults.push({
      tag: 'Computed',
      kind: ASTResultKind.COMPOSITION,
      imports: [{
        named: ['computed'],
        external: (options.compatible) ? '@vue/composition-api' : 'vue'
      }],
      reference: ReferenceKind.VARIABLE_VALUE,
      attributes: [getterName],
      nodes: [
        (setter) ? resultNode : tsModule.setSyntheticTrailingComments(tsModule.setSyntheticLeadingComments(resultNode, leadingComments), trailingComments)
      ] as ts.Statement[]
    })
  })

  syncRelatedASTResults.forEach(({ attributes, nodes, types }) => {
    const [_, getterNode, setterNode] = nodes;
    const name = getStringAttribute(attributes, 1);
    const typeNode = types?.length ? convertTypeToTypeNode(types[0], tsModule) : undefined;

    const resultNode = tsModule.createVariableStatement(
      undefined,
      tsModule.createVariableDeclarationList([
        tsModule.createVariableDeclaration(
          tsModule.createIdentifier(name),
          undefined,
          tsModule.createCall(
            tsModule.createIdentifier('computed'),
            typeNode ? [typeNode] : undefined,
            [
              tsModule.createObjectLiteral([
                tsModule.createPropertyAssignment(
                  tsModule.createIdentifier('get'),
                  getterNode as ts.Expression
                ),
                tsModule.createPropertyAssignment(
                  tsModule.createIdentifier('set'),
                  setterNode as ts.Expression
                )
              ], true)
            ]
          )
        )
      ],
        tsModule.NodeFlags.Const)
    )

    computedASTResults.push({
      tag: 'Computed',
      kind: ASTResultKind.COMPOSITION,
      imports: [{
        named: ['computed'],
        external: (options.compatible) ? '@vue/composition-api' : 'vue'
      }],
      reference: ReferenceKind.VARIABLE_VALUE,
      attributes: [name],
      nodes: [resultNode]
    })
  })

  return [
    ...computedASTResults,
    ...syncRelatedASTResults,
    ...otherASTResults
  ]
}
