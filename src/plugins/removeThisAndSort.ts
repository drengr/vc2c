import { ASTTransform, ASTResult, ReferenceKind, ASTResultKind } from './types'
import type ts from 'typescript'
import { addTodoComment, getStringAttribute, convertTypeToTypeNode } from '../utils'

export const removeThisAndSort: ASTTransform = (astResults, options, program) => {
  const tsModule = options.typescript
  const getReferences = (reference: ReferenceKind) => astResults
    .filter((el) => el.reference === reference)
    .map((el) => el.attributes)
    .reduce((array, el) => array.concat(el), [])

  const refVariables = getReferences(ReferenceKind.VARIABLE_VALUE)
  const domeRefVariables = getReferences(ReferenceKind.VARIABLE_NON_NULL_VALUE)
  const propVariables = getReferences(ReferenceKind.PROPS)
  const variables = getReferences(ReferenceKind.VARIABLE)

  const convertContextKey = (key: string) => {
    const contextKey = new Map([
      ['$attrs', 'attrs'],
      ['$slots', 'slots'],
      ['$parent', 'parent'],
      ['$root', 'root'],
      ['$listeners', 'listeners'],
      ['$emit', 'emit']
    ])

    return contextKey.get(key)
  }

  let dependents: string[] = []
  const emittedData: Record<string, ts.Type | undefined> = {};

  const captureEmit = (node: ts.PropertyAccessExpression) => {
    const emitNode = node.parent;
    if (tsModule.isCallExpression(emitNode)) {
      const [eventNameNode, eventParamsNode] = emitNode.arguments;
      const eventName = eventNameNode.getText().replace(/'/g, '',);
      const typeChecker = program.getTypeChecker();
      const typeObject = eventParamsNode ?
        typeChecker.getTypeAtLocation(eventParamsNode) :
        undefined;

      if (!emittedData[eventName]) {
        emittedData[eventName] = typeObject;
      }
    }
  }

  const generateEventNode = (eventName: string, type: ts.Type | undefined) => {
    const parameters = [
      tsModule.createParameter(
        undefined,
        undefined,
        undefined,
        "e",
        undefined,
        tsModule.createLiteralTypeNode(tsModule.createStringLiteral(eventName)),
      )
    ];

    if (type) {
      parameters.push(tsModule.createParameter(
        undefined,
        undefined,
        undefined,
        "data",
        undefined,
        convertTypeToTypeNode(type, tsModule)
      ));
    }

    return tsModule.createMethodSignature(
      undefined,
      parameters,
      tsModule.createKeywordTypeNode(tsModule.SyntaxKind.VoidKeyword),
      '',
      undefined
    );
  }

  const generateEmitNode = () => {
    const typeMembers = Object.entries(emittedData).map(([key, type]) => generateEventNode(key, type));
    const typeNode = tsModule.createTypeLiteralNode(typeMembers);

    const emitVariableNode = tsModule.createVariableStatement(
      [],
      tsModule.createVariableDeclarationList(
        [
          tsModule.createVariableDeclaration(
            'emit',
            undefined,
            tsModule.createCall(
              tsModule.createIdentifier('defineEmits'),
              [typeNode],
              undefined
            )
          ),
        ],
        tsModule.NodeFlags.Const
      )
    );

    return emitVariableNode;
  }

  const transformer: () => ts.TransformerFactory<ts.Node> = () => {
    return (context) => {
      const removeThisVisitor: ts.Visitor = (node) => {
        if (tsModule.isPropertyAccessExpression(node)) {
          if (node.expression.kind === tsModule.SyntaxKind.ThisKeyword) {
            const propertyName = node.name.escapedText.toString();
            if (refVariables.includes(propertyName)) {
              dependents.push(propertyName)
              return tsModule.createPropertyAccess(
                tsModule.createIdentifier(propertyName),
                tsModule.createIdentifier('value')
              )
            } else if (domeRefVariables.includes(propertyName)) {
              dependents.push(propertyName)
              return tsModule.createNonNullExpression(
                tsModule.createPropertyAccess(
                  tsModule.createIdentifier(propertyName),
                  tsModule.createIdentifier('value')
                )
              )
            } else if (propVariables.includes(propertyName)) {
              dependents.push(propertyName)
              return tsModule.createPropertyAccess(
                tsModule.createIdentifier(options.setupPropsKey),
                tsModule.createIdentifier(propertyName)
              )
            } else if (variables.includes(propertyName)) {
              dependents.push(propertyName)
              return tsModule.createIdentifier(propertyName)
            } else {
              const convertKey = convertContextKey(propertyName)
              if (convertKey) {
                if (convertKey === 'emit') {
                  captureEmit(node)
                  return tsModule.createIdentifier(convertKey);
                }

                return tsModule.createPropertyAccess(
                  tsModule.createIdentifier(options.setupContextKey),
                  tsModule.createIdentifier(convertKey)
                )
              }

              return addTodoComment(
                tsModule,
                tsModule.createPropertyAccess(
                  tsModule.createPropertyAccess(
                    tsModule.createIdentifier(options.setupContextKey),
                    tsModule.createIdentifier('root')
                  ),
                  tsModule.createIdentifier(propertyName)
                ),
                'Check this convert result, it can work well in 80% case.',
                true
              )
            }
          }
          return tsModule.visitEachChild(node, removeThisVisitor, context)
        }
        return tsModule.visitEachChild(node, removeThisVisitor, context)
      }

      return (node) => tsModule.visitNode(node, removeThisVisitor)
    }
  }

  type TransformResult = ASTResult<ts.Node> & {
    nodes: ts.Node[];
    nodeDependents: string[];
  }

  const transformResults = astResults.reduce<TransformResult[]>((acc, astResult) => {
    if (astResult.kind === ASTResultKind.OBJECT) {
      acc.push({
        ...astResult,
        nodeDependents: []
      });
      return acc;
    }

    if (astResult.tag === 'PropSync' && astResult.types) {
      emittedData[`update:${astResult.attributes[0]}`] = astResult.types[0];
      return acc;
    } else if (astResult.tag === 'ModelSync' && astResult.types) {
      const name = getStringAttribute(astResult.attributes, 0);

      emittedData[name] = astResult.types[0];
      return acc;
    }

    dependents = []
    const nodes = tsModule.transform(
      astResult.nodes,
      [transformer()],
      { module: tsModule.ModuleKind.ESNext }
    ).transformed

    const nodeDependents = dependents.slice();

    acc.push({
      ...astResult,
      nodes,
      nodeDependents
    });

    return acc;
  }, []);

  const astResultNoDependents = transformResults.filter((el) => el.nodeDependents.length === 0)
  let otherASTResults = transformResults.filter((el) => el.nodeDependents.length !== 0)
  let result: ASTResult<ts.Node>[] = [...astResultNoDependents]
  const resultHaveDependents = astResultNoDependents.map((el) => el.attributes).reduce((array, el) => array.concat(el), [])
  do {
    let hasPush = false
    otherASTResults = otherASTResults.filter((el) => {
      if (el.nodeDependents.every((dependent) => resultHaveDependents.includes(dependent))) {
        result.push(el)
        hasPush = true
        return false
      } else {
        return true
      }
    })
    if (!hasPush) {
      result = result.concat(otherASTResults)
      break
    }
  } while (result.length < astResults.length)


  const emitNode = Object.keys(emittedData).length ? generateEmitNode() : undefined;

  if (emitNode) {
    result.push({
      attributes: [],
      imports: [],
      kind: ASTResultKind.COMPOSITION,
      nodes: [emitNode],
      reference: ReferenceKind.VARIABLE,
      tag: 'Emit',
    });
  }

  return result
}
