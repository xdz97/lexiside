import { defineConfig } from 'wxt';
import { releaseDocumentHooks } from './build/release-documents';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: releaseDocumentHooks,
  manifest: {
    name: '拾词 LexiSide',
    short_name: '拾词',
    description: '在英文网页中快速理解，并把值得学习的词与表达连同语境保存到本地。',
    version: '0.1.2',
    minimum_chrome_version: '142',
    permissions: ['storage', 'unlimitedStorage', 'contextMenus', 'sidePanel', 'tts', 'offscreen'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: '打开拾词侧边栏',
      default_icon: {
        16: 'icon-16.png',
        32: 'icon-32.png',
        48: 'icon-48.png',
      },
    },
    icons: {
      16: 'icon-16.png',
      32: 'icon-32.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    commands: {
      'translate-selection': {
        suggested_key: {
          default: 'Alt+T',
          mac: 'Alt+T',
        },
        description: '翻译当前选区',
      },
      'save-selection': {
        suggested_key: {
          default: 'Alt+S',
          mac: 'Alt+S',
        },
        description: '保存当前内容',
      },
    },
  },
});
