// Zone F (app chrome) translations: persistent Report-bug button, the global
// update banner, and the language restart prompt. Merged into UI_TEXT by
// ../i18n.ts (see the i18n-extra glob-merge).
import type { ResolvedLanguage } from '../i18n'

const keys: Partial<Record<ResolvedLanguage, Record<string, string>>> = {
  en: {
    'chrome.reportBug': 'REPORT A BUG, IMPROVEMENTS OR FEATURES REQUEST',
    'chrome.reportBugTitle': 'Collect the last 2h of logs and open a GitHub issue',
    'chrome.reportBugAria': 'Report a bug',
    'chrome.reportBugDone': 'Bug report opened. Please attach the log bundle from the logs folder that just opened.',
    'chrome.reportBugFailed': 'Could not open the bug report',
    'chrome.update.bannerTitle': 'Update available',
    'chrome.update.bannerAvailable': 'Version {version} is available.',
    'chrome.update.bannerDownloading': 'Downloading update… {pct}%',
    'chrome.update.bannerDownloaded': 'Update {version} is ready — restart to install.',
    'chrome.update.download': 'Download',
    'chrome.update.install': 'Install & close',
    'chrome.update.dismiss': 'Later',
    'settings.languageRestartConfirm': 'Restart the app now to apply the new language everywhere?'
  },
  'pt-BR': {
    'chrome.reportBug': 'REPORTAR BUG, MELHORIAS OU SOLICITAR RECURSOS',
    'chrome.reportBugTitle': 'Coleta as últimas 2h de logs e abre uma issue no GitHub',
    'chrome.reportBugAria': 'Reportar um bug',
    'chrome.reportBugDone': 'Relatório de bug aberto. Anexe o pacote de logs da pasta de logs que acabou de abrir.',
    'chrome.reportBugFailed': 'Não foi possível abrir o relatório de bug',
    'chrome.update.bannerTitle': 'Atualização disponível',
    'chrome.update.bannerAvailable': 'A versão {version} está disponível.',
    'chrome.update.bannerDownloading': 'Baixando atualização… {pct}%',
    'chrome.update.bannerDownloaded': 'Atualização {version} pronta — reinicie para instalar.',
    'chrome.update.download': 'Baixar',
    'chrome.update.install': 'Instalar e fechar',
    'chrome.update.dismiss': 'Depois',
    'settings.languageRestartConfirm': 'Reiniciar o app agora para aplicar o novo idioma em todo lugar?'
  },
  es: {
    'chrome.reportBug': 'REPORTAR ERROR, MEJORAS O SOLICITAR FUNCIONES',
    'chrome.reportBugTitle': 'Recopila las últimas 2 h de registros y abre una incidencia en GitHub',
    'chrome.reportBugAria': 'Reportar un error',
    'chrome.reportBugDone': 'Informe de error abierto. Adjunta el paquete de registros de la carpeta que se acaba de abrir.',
    'chrome.reportBugFailed': 'No se pudo abrir el informe de error',
    'chrome.update.bannerTitle': 'Actualización disponible',
    'chrome.update.bannerAvailable': 'La versión {version} está disponible.',
    'chrome.update.bannerDownloading': 'Descargando actualización… {pct}%',
    'chrome.update.bannerDownloaded': 'Actualización {version} lista: reinicia para instalar.',
    'chrome.update.download': 'Descargar',
    'chrome.update.install': 'Instalar y cerrar',
    'chrome.update.dismiss': 'Más tarde',
    'settings.languageRestartConfirm': '¿Reiniciar la app ahora para aplicar el nuevo idioma en todas partes?'
  },
  fr: {
    'chrome.reportBug': 'SIGNALER UN BUG, DES AMÉLIORATIONS OU DEMANDER DES FONCTIONNALITÉS',
    'chrome.reportBugTitle': 'Collecte les 2 dernières heures de journaux et ouvre une issue GitHub',
    'chrome.reportBugAria': 'Signaler un bug',
    'chrome.reportBugDone': 'Rapport de bug ouvert. Joignez le paquet de journaux du dossier qui vient de s’ouvrir.',
    'chrome.reportBugFailed': 'Impossible d’ouvrir le rapport de bug',
    'chrome.update.bannerTitle': 'Mise à jour disponible',
    'chrome.update.bannerAvailable': 'La version {version} est disponible.',
    'chrome.update.bannerDownloading': 'Téléchargement de la mise à jour… {pct}%',
    'chrome.update.bannerDownloaded': 'Mise à jour {version} prête — redémarrez pour l’installer.',
    'chrome.update.download': 'Télécharger',
    'chrome.update.install': 'Installer et fermer',
    'chrome.update.dismiss': 'Plus tard',
    'settings.languageRestartConfirm': 'Redémarrer l’app maintenant pour appliquer la nouvelle langue partout ?'
  },
  de: {
    'chrome.reportBug': 'FEHLER, VERBESSERUNGEN ODER FUNKTIONSWÜNSCHE MELDEN',
    'chrome.reportBugTitle': 'Sammelt die letzten 2 Std. Protokolle und öffnet ein GitHub-Issue',
    'chrome.reportBugAria': 'Einen Fehler melden',
    'chrome.reportBugDone': 'Fehlerbericht geöffnet. Bitte hänge das Protokollpaket aus dem soeben geöffneten Ordner an.',
    'chrome.reportBugFailed': 'Fehlerbericht konnte nicht geöffnet werden',
    'chrome.update.bannerTitle': 'Update verfügbar',
    'chrome.update.bannerAvailable': 'Version {version} ist verfügbar.',
    'chrome.update.bannerDownloading': 'Update wird heruntergeladen… {pct}%',
    'chrome.update.bannerDownloaded': 'Update {version} bereit — zum Installieren neu starten.',
    'chrome.update.download': 'Herunterladen',
    'chrome.update.install': 'Installieren & schließen',
    'chrome.update.dismiss': 'Später',
    'settings.languageRestartConfirm': 'Die App jetzt neu starten, um die neue Sprache überall anzuwenden?'
  },
  zh: {
    'chrome.reportBug': '报告错误、改进或功能请求',
    'chrome.reportBugTitle': '收集最近 2 小时的日志并打开 GitHub 问题',
    'chrome.reportBugAria': '报告错误',
    'chrome.reportBugDone': '已打开错误报告。请附上刚打开的日志文件夹中的日志包。',
    'chrome.reportBugFailed': '无法打开错误报告',
    'chrome.update.bannerTitle': '有可用更新',
    'chrome.update.bannerAvailable': '版本 {version} 已可用。',
    'chrome.update.bannerDownloading': '正在下载更新… {pct}%',
    'chrome.update.bannerDownloaded': '更新 {version} 已就绪 — 重启以安装。',
    'chrome.update.download': '下载',
    'chrome.update.install': '安装并关闭',
    'chrome.update.dismiss': '稍后',
    'settings.languageRestartConfirm': '立即重启应用以在各处应用新语言？'
  },
  ja: {
    'chrome.reportBug': 'バグ・改善・機能リクエストを報告',
    'chrome.reportBugTitle': '直近2時間のログを収集し、GitHub の Issue を開きます',
    'chrome.reportBugAria': 'バグを報告',
    'chrome.reportBugDone': 'バグ報告を開きました。開いたログフォルダーのログバンドルを添付してください。',
    'chrome.reportBugFailed': 'バグ報告を開けませんでした',
    'chrome.update.bannerTitle': 'アップデートが利用可能',
    'chrome.update.bannerAvailable': 'バージョン {version} が利用可能です。',
    'chrome.update.bannerDownloading': 'アップデートをダウンロード中… {pct}%',
    'chrome.update.bannerDownloaded': 'アップデート {version} の準備ができました — 再起動してインストール。',
    'chrome.update.download': 'ダウンロード',
    'chrome.update.install': 'インストールして終了',
    'chrome.update.dismiss': '後で',
    'settings.languageRestartConfirm': '新しい言語をすべてに適用するために、今すぐアプリを再起動しますか？'
  }
}

export default keys
