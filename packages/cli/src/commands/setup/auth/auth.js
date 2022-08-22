import fs from 'fs'
import path from 'path'

import Listr from 'listr'
import prompts from 'prompts'
import terminalLink from 'terminal-link'

import { errorTelemetry } from '@redwoodjs/telemetry'

import { getPaths } from '../../../lib'
import c from '../../../lib/colors'
import { isTypeScriptProject } from '../../../lib/project'

import { files } from './authFiles'
import {
  generateAuthApi,
  addAuthConfigToWeb,
  addAuthConfigToGqlApi,
  addWebPackages,
  addApiPackages,
  installPackages,
  printNotes,
  getSupportedProviders,
} from './authTasks'

const WEBAUTHN_SUPPORTED_PROVIDERS = ['dbAuth']

/**
 * Check if one of the api side auth files already exists and if so, ask the
 * user to overwrite
 */
async function shouldForce(force, provider, webAuthn) {
  if (force) {
    return true
  }

  const existingFiles = Object.keys(files({ provider, webAuthn })).filter(
    (filePath) => fs.existsSync(filePath)
  )

  if (existingFiles.length > 0) {
    const shortPaths = existingFiles.map((filePath) =>
      filePath.replace(getPaths().base, '')
    )
    const forceResponse = await prompts({
      type: 'confirm',
      name: 'answer',
      message: `Overwrite existing ${shortPaths.join(', ')}?`,
      initial: false,
    })

    return forceResponse.answer
  }

  return false
}

/**
 * Prompt the user (unless already specified on the command line) if they want
 * to enable WebAuthn support if they're setting up an auth service provider
 * that has support for it.
 * Right now, only dbAuth supports WebAuthn, but in theory it could work with
 * any provider, so we'll do a check here and potentially use the webAuthn
 * version of its provider
 */
async function shouldIncludeWebAuthn(webauthn, provider) {
  if (webauthn === null && WEBAUTHN_SUPPORTED_PROVIDERS.includes(provider)) {
    const webAuthnResponse = await prompts({
      type: 'confirm',
      name: 'answer',
      message: `Enable WebAuthn support (TouchID/FaceID)? See https://redwoodjs.com/docs/auth/dbAuth#webAuthn`,
      initial: false,
    })

    return webAuthnResponse.answer
  }

  return webauthn
}

export const command = 'auth <provider>'
export const description = 'Generate an auth configuration'
export const builder = (yargs) => {
  yargs
    .positional('provider', {
      choices: getSupportedProviders(),
      description: 'Auth provider to configure',
      type: 'string',
    })
    .option('force', {
      alias: 'f',
      default: false,
      description: 'Overwrite existing configuration',
      type: 'boolean',
    })
    .option('webauthn', {
      alias: 'w',
      default: null,
      description: 'Include WebAuthn support (TouchID/FaceID)',
      type: 'boolean',
    })
    .epilogue(
      `Also see the ${terminalLink(
        'Redwood CLI Reference',
        'https://redwoodjs.com/docs/cli-commands#setup-auth'
      )}`
    )
}

export const handler = async ({
  provider,
  rwVersion,
  webauthn,
  force: forceArg,
}) => {
  const force = await shouldForce(forceArg, provider, webauthn)
  const includeWebAuthn = await shouldIncludeWebAuthn(webauthn, provider)
  const providerData = includeWebAuthn
    ? await import(`./providers/${provider}/${provider}.webAuthn`)
    : await import(`./providers/${provider}/${provider}`)

  const tasks = new Listr(
    [
      generateAuthApi(provider, force, includeWebAuthn),
      addAuthConfigToWeb(provider),
      addAuthConfigToGqlApi,
      addWebPackages(provider, providerData.webPackages, rwVersion),
      addApiPackages(provider, providerData.apiPackages),
      installPackages,
      providerData.task,
      printNotes(providerData.notes),
    ].filter(Boolean),
    { collapse: false }
  )

  try {
    await tasks.run()
  } catch (e) {
    errorTelemetry(process.argv, e.message)
    console.error(c.error(e.message))
    process.exit(e?.exitCode || 1)
  }
}
