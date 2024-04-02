import { ASTConverter, ASTResultKind, ReferenceKind } from '../types'
import type ts from 'typescript'
import { copySyntheticComments } from '../../utils'

export const convertMethod: ASTConverter<ts.MethodDeclaration> = (node, options) => {
  const tsModule = options.typescript
  const methodName = node.name.getText()

  const outputMethod = tsModule.createFunctionDeclaration(
    undefined,
    node.modifiers,
    undefined,
    methodName,
    node.typeParameters,
    node.parameters,
    node.type,
    node.body ?? tsModule.createBlock([])
  );

  return {
    tag: 'Method',
    kind: ASTResultKind.COMPOSITION,
    imports: [],
    reference: ReferenceKind.VARIABLE,
    attributes: [methodName],
    nodes: [
      copySyntheticComments(tsModule, outputMethod, node),
    ] as ts.Statement[]
  }
}
