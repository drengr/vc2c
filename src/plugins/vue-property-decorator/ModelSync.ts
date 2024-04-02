import { ASTConverter, ASTResultKind, ReferenceKind } from '../types'
import type ts from 'typescript'
import { copySyntheticComments, addTodoComment } from '../../utils'
import type { Vc2cOptions } from '../../options'

const propDecoratorName = 'ModelSync'

const createGetter = (propName: string, options: Vc2cOptions): ts.ArrowFunction => {
  const tsModule = options.typescript;

  return tsModule.createArrowFunction(
    undefined,
    undefined,
    [],
    undefined,
    tsModule.createToken(tsModule.SyntaxKind.EqualsGreaterThanToken),
    tsModule.createBlock([
      tsModule.createReturn(
        tsModule.createPropertyAccess(
          tsModule.createIdentifier('props'),
          tsModule.createIdentifier(propName)
        )
      )
    ], true)
  );
}

const createSetter = (eventName: string, node: ts.Node, { typescript: tsModule }: Vc2cOptions): ts.ArrowFunction => {
  if (!tsModule.isPropertyDeclaration(node)) {
    throw Error('Wrong type');
  }
  const parameter = tsModule.createParameter(
    undefined,
    undefined,
    undefined,
    'value',
    undefined,
    undefined,
    undefined
  );

  return tsModule.createArrowFunction(
    undefined,
    undefined,
    [parameter],
    undefined,
    tsModule.createToken(tsModule.SyntaxKind.EqualsGreaterThanToken),
    tsModule.createBlock([
      tsModule.createExpressionStatement(
        tsModule.createCall(
          tsModule.createIdentifier('emit'),
          undefined,
          [
            tsModule.createStringLiteral(eventName),
            tsModule.createIdentifier('value')
          ]
        )
      )
    ], true)
  );
}

export const convertModelSync: ASTConverter<ts.PropertyDeclaration> = (node, options, program) => {
  if (!node.decorators) {
    return false
  }
  const decorator = node.decorators.find((el) => (el.expression as ts.CallExpression).expression.getText() === propDecoratorName)
  if (decorator) {
    const tsModule = options.typescript
    const decoratorArguments = (decorator.expression as ts.CallExpression).arguments;

    if (decoratorArguments.length > 0) {
      const propName = decoratorArguments[0].getText().replace(/'/g, '');
      const eventName = decoratorArguments[1].getText().replace(/'/g, '');
      const computedName = node.name.getText();
      const getterRelatedNode = createGetter(propName, options);
      const setterRelatedNode = createSetter(eventName, node, options);

      const typeChecker = program.getTypeChecker();
      const typeObject = typeChecker.getTypeAtLocation(node);

      return {
        tag: 'ModelSync',
        kind: ASTResultKind.COMPOSITION,
        imports: [],
        reference: ReferenceKind.PROPS,
        attributes: [propName, computedName],
        nodes: [
          copySyntheticComments(
            tsModule,
            tsModule.createPropertySignature(undefined, propName, node.questionToken, node.type, undefined),
            node
          ),
          addTodoComment(tsModule, copySyntheticComments(tsModule, getterRelatedNode, node), 'check ModelSync content', true),
          setterRelatedNode,
        ],
        types: [typeObject]
      }
    }
  }

  return false
}
