import { ASTConverter, ASTResultKind, ASTTransform, ReferenceKind, ASTResultToComposition } from '../types'
import type ts from 'typescript'
import { copySyntheticComments, getStringAttribute, getExpressionAttribute } from '../../utils'
import type { Vc2cOptions } from '../../options'

const propDecoratorName = 'Prop'

export const convertProp: ASTConverter<ts.PropertyDeclaration> = (node, options) => {
  if (!node.decorators) {
    return false
  }
  const decorator = node.decorators.find((el) => (el.expression as ts.CallExpression).expression.getText() === propDecoratorName)
  if (decorator) {
    const tsModule = options.typescript
    const decoratorArguments = (decorator.expression as ts.CallExpression).arguments
    if (decoratorArguments.length > 0) {
      const propName = node.name.getText()
      const propArguments = decoratorArguments[0] as ts.Identifier;
      let defaultValue;

      return {
        tag: 'Prop',
        kind: ASTResultKind.OBJECT,
        imports: [],
        reference: ReferenceKind.PROPS,
        attributes: [propName, propArguments],
        nodes: [
          copySyntheticComments(
            tsModule,
            tsModule.createPropertySignature(undefined, propName, node.questionToken, node.type, undefined),
            node
          )
        ]
      }
    }
  }

  return false
}

const getDefaultValue = (node: ts.Expression, options: Vc2cOptions): ts.Expression | ts.BooleanLiteral | null => {
  const tsModule = options.typescript;
  let value: ts.Expression | ts.BooleanLiteral | null = null;

  if (tsModule.isObjectLiteralExpression(node)) {
    node.properties.forEach(p => {
      if (tsModule.isPropertyAssignment(p) && p.name?.getText() === 'default') {
        value = (p as ts.PropertyAssignment).initializer;
      }
    })
  } else if (tsModule.isIdentifier(node) && node.getText() === 'Boolean') {
    value = tsModule.createFalse();
  }

  return value;
}

export const mergeProps: ASTTransform = (astResults, options) => {
  const tsModule = options.typescript
  const propTags = ['Prop', 'PropSync', 'Model']

  const propASTResults = astResults.filter((el) => propTags.includes(el.tag))
  const otherASTResults = astResults.filter((el) => !propTags.includes(el.tag))
  const modelASTResult = astResults.find((el) => el.tag === 'Model');
  const propSyncASTResults = astResults.filter((el) => el.tag === 'PropSync');

  const { nodes: propNodes, values } = propASTResults.reduce<{ nodes: ts.TypeElement[], values: Record<string, any> }>((acc, result) => {
    let nodes: ts.PropertySignature[] = [];

    switch (result.tag) {
      case 'Prop':
        nodes = result.nodes as ts.PropertySignature[];
        break;
      case 'PropSync':
        nodes = [result.nodes[0]] as ts.PropertySignature[];
        break;
      case 'Model':
        nodes = [result.nodes[1]] as ts.PropertySignature[];
        break;

      default:
        break;
    }

    acc.nodes.push(...nodes);

    if (nodes[0].questionToken) {
      const propName = getStringAttribute(result.attributes, 0);
      const propParams = getExpressionAttribute(result.attributes, 1);
      const defaultValue = propParams ? getDefaultValue(propParams, options) : undefined;

      if (defaultValue) {
        acc.values[propName] = defaultValue;
      }
    }

    return acc;
  }, { nodes: [], values: {} });
  const mustSetDefaults = !!Object.keys(values).length;

  const propsInterface = tsModule.createInterfaceDeclaration(undefined, undefined, 'Props', undefined, undefined, propNodes);
  const definePropsCall = tsModule.createCall(
    tsModule.createIdentifier("defineProps"),
    [tsModule.createTypeParameterDeclaration('Props', undefined, undefined) as unknown as ts.TypeNode],
    []
  );

  const propsConst = mustSetDefaults ?
    tsModule.createVariableStatement(
      [],
      tsModule.createVariableDeclarationList(
        [
          tsModule.createVariableDeclaration(
            "props",
            undefined,
            tsModule.createCall(
              tsModule.createIdentifier("withDefaults"),
              undefined,
              [
                definePropsCall,
                tsModule.createObjectLiteral(Object.entries(values)
                  .map(([key, value]) => tsModule.createPropertyAssignment(key, value))),
              ]
            )
          ),
        ],
        tsModule.NodeFlags.Const
      )
    ) :
    tsModule.createVariableStatement(
      [],
      tsModule.createVariableDeclarationList(
        [
          tsModule.createVariableDeclaration("props", undefined, definePropsCall),
        ],
        tsModule.NodeFlags.Const
      )
    );

  const mergeASTResult: ASTResultToComposition<any> = {
    tag: 'Prop',
    kind: ASTResultKind.COMPOSITION,
    imports: [],
    reference: ReferenceKind.PROPS,
    attributes: propASTResults.map((el) => el.attributes).reduce((array, el) => array.concat(el), []),
    nodes: [
      propsInterface,
      propsConst
    ]
  }

  return [
    ...(modelASTResult) ? [{
      ...modelASTResult,
      nodes: modelASTResult.nodes.slice(0, 1) as ts.PropertyAssignment[]
    }] : [],
    mergeASTResult,
    ...propSyncASTResults,
    ...otherASTResults
  ]
}
