import { existsSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { WxtHooks } from 'wxt';

interface PackageInfo {
  name: string;
  version: string;
  license?: string;
  repository?: string | { url?: string };
}

// New license types need review before a release can be produced.
const reviewedLicenses = new Set(['MIT', 'ISC', 'BSD-3-Clause', 'OFL-1.1']);

export const releaseDocumentHooks: Partial<WxtHooks> = {
  'build:done'(wxt, output) {
    if (wxt.config.command === 'serve') return;
    const root = resolve(wxt.config.root, '../..');
    const packageDirs = new Set<string>();
    const checkedDirs = new Set<string>();
    // WXT reports modules from every emitted entrypoint, including its own
    // injected runtime and asset imports. Do not traverse unrelated workspaces
    // or include all development dependencies from package-lock.json.
    for (const step of output.steps) {
      for (const chunk of step.chunks) {
        if (chunk.type !== 'chunk') continue;
        for (const id of chunk.moduleIds) {
          const file = id.split('?')[0]!;
          if (!isAbsolute(file) || !file.includes('/node_modules/')) continue;
          let dir = dirname(file);
          while (!checkedDirs.has(dir)) {
            checkedDirs.add(dir);
            const manifest = join(dir, 'package.json');
            if (existsSync(manifest)) {
              const info = JSON.parse(readFileSync(manifest, 'utf8')) as PackageInfo;
              if (info.name && info.version) {
                if (!info.name.startsWith('@lexiside/')) packageDirs.add(dir);
                break;
              }
            }
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
          }
        }
      }
    }

    const packages = [...packageDirs].map((dir) => {
      const info = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageInfo;
      if (!info.license || !reviewedLicenses.has(info.license)) {
        throw new Error(`发布前需核查许可证：${info.name}@${info.version} (${info.license ?? '未声明'})`);
      }
      // These npm tarballs omit LICENSE. Preserve the upstream project's
      // license locally; SOURCE.txt records the pinned references.
      const useWxtLicense = (info.name === 'wxt' && info.version === '0.21.4')
        || (info.name === '@wxt-dev/browser' && info.version === '0.3.0');
      const licenseDir = useWxtLicense
        ? join(root, 'third-party-licenses/wxt-0.21.4')
        : dir;
      const files = readdirSync(licenseDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^(licen[cs]e|copying|notice)(?:$|[.-])/i.test(entry.name))
        .map((entry) => entry.name).sort();
      if (!files.some((file) => /^(licen[cs]e|copying)(?:$|[.-])/i.test(file))) {
        throw new Error(`缺少完整许可证文件，停止发布：${info.name}@${info.version}`);
      }
      const repository = typeof info.repository === 'string' ? info.repository : info.repository?.url;
      return {
        ...info,
        text: [
          '='.repeat(72),
          `${info.name}@${info.version}`,
          `License: ${info.license}`,
          ...(repository ? [`Source: ${repository.replace(/^git\+/, '')}`] : []),
          ...files.flatMap((file) => [`\n--- ${file} ---\n`, readFileSync(join(licenseDir, file), 'utf8')]),
        ].join('\n'),
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));

    // A missing module inventory must never silently produce an empty notice.
    const required = ['react', 'react-dom', '@mui/material', 'zod', 'lucide-react', '@fontsource-variable/inter', 'wxt'];
    for (const name of required) {
      if (!packages.some((info) => info.name === name)) throw new Error(`构建依赖清单缺少 ${name}，停止发布`);
    }
    const notices = [
      '拾词 LexiSide — Third-Party Notices / 第三方版权与许可声明',
      '',
      '本文件保留本次构建涉及的第三方组件的版权、完整许可条款及免责声明。',
      '各组件按其下方的原始许可证授权；组件许可不代表其作者为拾词背书。',
      '这些第三方许可证不自动适用于拾词自身代码、名称或图标。',
      '重新分发本包时，请保留本文件及包内已有的第三方许可文件。',
      '',
      'Component index:',
      ...packages.map((info) => `${info.name}@${info.version} — ${info.license}`),
      '',
      ...packages.map((info) => info.text),
      '',
    ].join('\n');
    writeFileSync(join(root, 'THIRD_PARTY_NOTICES.txt'), notices);
    writeFileSync(join(wxt.config.outDir, 'THIRD_PARTY_NOTICES.txt'), notices);
    for (const file of ['INSTALL.txt', 'PRIVACY.md']) copyFileSync(join(root, file), join(wxt.config.outDir, file));
    for (const fileName of ['THIRD_PARTY_NOTICES.txt', 'INSTALL.txt', 'PRIVACY.md']) {
      output.publicAssets.push({ type: 'asset', fileName });
    }
    wxt.logger.info(`已附带安装、隐私说明及 ${packages.length} 个第三方组件的完整许可声明`);
  },
};
