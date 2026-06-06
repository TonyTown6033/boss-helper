import { ElMessage } from 'element-plus'

import type { TechwolfChatProtocol } from './type'
import { AwesomeMessage } from './type'

interface MessageArgs {
  form_uid: string
  to_uid: string
  to_name: string // encryptBossId  擦,boss的id不是岗位的
  content?: string
  image?: string // url
}

interface ChatSdkUser {
  uid: number | string
  encryptUid: string
  friendSource: number
  source: number
}

interface GeekChatCoreInitConfig {
  userId: number | string
  token: string
  platform: 'web'
  friendSource: number
  supportPush: boolean
}

function isObject(value: unknown): value is Record<string, any> {
  return (typeof value === 'object' && value != null) || typeof value === 'function'
}

function getFunction<T extends (...args: any[]) => any>(value: unknown, key: string): T | undefined {
  if (!isObject(value)) {
    return undefined
  }
  const fn = value[key]
  return typeof fn === 'function' ? (fn as T) : undefined
}

async function resolveMaybePromise<T>(value: T | Promise<T>): Promise<T> {
  return await Promise.resolve(value)
}

export class Message {
  msg: Uint8Array
  hex: string
  args: MessageArgs

  constructor(args: MessageArgs) {
    this.args = args
    const r = new Date().getTime()
    const d = r + 68256432452609
    const data: TechwolfChatProtocol = {
      messages: [
        {
          from: {
            uid: args.form_uid,
            source: 0,
          },
          to: {
            uid: args.to_uid,
            name: args.to_name,
            source: 0,
          },
          type: 1,
          mid: d.toString(),
          time: r.toString(),
          body: {
            type: 1,
            templateId: 1,
            text: args.content,
            // image: {},
          },
          cmid: d.toString(),
        },
      ],
      type: 1,
    }

    this.msg = AwesomeMessage.encode(data).finish().slice()
    this.hex = [...this.msg].map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  toArrayBuffer(): ArrayBuffer {
    return this.msg.buffer.slice(0, this.msg.byteLength) as ArrayBuffer
  }

  private getChatUser(): ChatSdkUser {
    const uid = Number(this.args.to_uid)
    return {
      uid: Number.isFinite(uid) ? uid : this.args.to_uid,
      encryptUid: this.args.to_name,
      friendSource: 0,
      source: 0,
    }
  }

  private async trySdkTextSend(sdk: unknown): Promise<boolean> {
    if (!this.args.content) {
      return false
    }
    const user = this.getChatUser()
    const sendMessage =
      getFunction<(user: ChatSdkUser, content: string, type: 'text') => unknown>(
        sdk,
        'sendMessage',
      )
    if (sendMessage) {
      await resolveMaybePromise(sendMessage.call(sdk, user, this.args.content, 'text'))
      return true
    }
    const sendTextMessage =
      getFunction<(user: ChatSdkUser, content: string) => unknown>(sdk, 'sendTextMessage')
    if (sendTextMessage) {
      await resolveMaybePromise(sendTextMessage.call(sdk, user, this.args.content))
      return true
    }
    return false
  }

  private async tryRawSend(channel: unknown): Promise<boolean> {
    const send = getFunction<(message: Message) => unknown>(channel, 'send')
    if (!send) {
      return false
    }
    await resolveMaybePromise(send.call(channel, this))
    return true
  }

  private async getGeekChatInstance(diagnostics: string[]): Promise<unknown> {
    const geekChatCore = window.GeekChatCore
    if (!geekChatCore) {
      diagnostics.push('GeekChatCore 不存在')
      return undefined
    }

    const getInstance = getFunction<() => unknown>(geekChatCore, 'getInstance')
    if (getInstance) {
      try {
        const instance = getInstance.call(geekChatCore)
        if (instance) {
          return instance
        }
      } catch (error) {
        diagnostics.push(`GeekChatCore.getInstance 失败: ${String(error)}`)
      }
    }

    const init = getFunction<(config: GeekChatCoreInitConfig) => unknown>(geekChatCore, 'init')
    const userId = window._PAGE?.userId ?? window._PAGE?.uid
    const token = window._PAGE?.token
    if (init && userId && token) {
      try {
        return await resolveMaybePromise(
          init.call(geekChatCore, {
            userId,
            token,
            platform: 'web',
            friendSource: 0,
            supportPush: false,
          }),
        )
      } catch (error) {
        diagnostics.push(`GeekChatCore.init 失败: ${String(error)}`)
      }
    }

    diagnostics.push('GeekChatCore 未初始化或缺少初始化参数')
    return undefined
  }

  async send() {
    const diagnostics: string[] = []
    const geekChatInstance = await this.getGeekChatInstance(diagnostics)

    if (geekChatInstance) {
      if (await this.trySdkTextSend(geekChatInstance)) {
        return
      }
      if (await this.tryRawSend(geekChatInstance)) {
        return
      }

      const getClient = getFunction<() => unknown>(geekChatInstance, 'getClient')
      const client = getClient?.call(geekChatInstance)
      if (await this.tryRawSend(client)) {
        return
      }
      if (isObject(client) && (await this.tryRawSend(client.client))) {
        return
      }
      diagnostics.push(
        'GeekChatCore 已存在但未找到 sendMessage/sendTextMessage/send/getClient().send/getClient().client.send',
      )
    }

    if ('ChatWebsocket' in window && window.ChatWebsocket != null) {
      await resolveMaybePromise(window.ChatWebsocket.send(this))
      return
    }
    // else if (window.EventBus != null) { // 2025-12-22 失效，疑似boss bug。暂时禁用
    //   window.EventBus.publish('CHAT_SEND_TEXT', {
    //     uid: this.args.to_uid,
    //     encryptUid: this.args.to_name,
    //     message: this.args.content,
    //     msg: this.args.content,
    //   }, () => {
    //     logger.debug('消息发送成功', this)
    //   }, () => {
    //     logger.error('消息发送失败', this)
    //   })
    // }
    // else if (window.__q_chatSend != null) { // 扩展限制，不能远程加载，暂不考虑实现
    //   // 当无渠道时，从网络加载临时补丁
    //   window.__q_chatSend.call(this).then(() => {
    //     logger.debug('消息发送成功', this)
    //   }, () => {
    //     logger.debug('消息发送失败', this)
    //   })
    // }
    else {
      const message =
        `无可用发送渠道，请等待作者修复。可暂时关闭招呼语功能。诊断: ${diagnostics.join('; ')}; ChatWebsocket 不存在`
      ElMessage.error(message)
      throw new Error(message)
    }
  }
}
