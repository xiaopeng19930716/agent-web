; 自定义 NSIS 安装脚本：默认显示安装细节（实时解压/复制文件列表），
; 避免大体积包安装时黑盒等待。
!macro NSIS_HOOK_PREINIT
  ShowInstDetails show
!macroend

!macro NSIS_HOOK_POSTINIT
  ShowInstDetails show
!macroend
