/* eslint-disable @typescript-eslint/no-var-requires */
import { Vc2cOptions } from './options'
import path from 'path'
import { log } from './debug'
import prettier from 'prettier/standalone'
import prettierTypescriptParser from 'prettier/parser-typescript'
import { existsFileSync } from './file'

export function format (content: string, options: Vc2cOptions): string {
  const isNode = typeof window === 'undefined'
  if (!isNode) {
    return prettier.format(content, {
      plugins: [prettierTypescriptParser],
      parser: 'typescript',
      semi: false,
      singleQuote: true
    })
  }

  const eslintConfigPath = path.resolve(options.root, options.eslintConfigFile)

  log('Format result code.....')
  return content
}
