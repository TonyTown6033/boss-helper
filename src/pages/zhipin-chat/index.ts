import { createApp } from 'vue'
import { createPinia } from 'pinia'

import { useModel } from '@/composables/useModel'
import { useConf } from '@/stores/conf'
import { useSignedKey } from '@/stores/signedKey'
import { logger } from '@/utils/logger'

import ChatCapture from './components/ChatCapture.vue'

export async function run() {
  logger.info('加载/web/geek/chat页面Hook')
  if (document.querySelector('#boss-helper-chat')) {
    return
  }

  const appEl = document.createElement('div')
  appEl.id = 'boss-helper-chat'
  document.body.append(appEl)

  const pinia = createPinia()
  const app = createApp(ChatCapture)
  app.use(pinia)
  app.mount(appEl)

  void useConf(pinia).confInit()
  void useModel(pinia).initModel()
  void useSignedKey(pinia).initSignedKey()
}
