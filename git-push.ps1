$env:Path += ';C:\Program Files\Git\cmd'
$key = Join-Path $env:USERPROFILE '.ssh\fluxlibre_deploy_key'
$env:GIT_SSH_COMMAND = '"C:\Program Files\Git\usr\bin\ssh.exe" -i "' + $key + '" -o StrictHostKeyChecking=accept-new'
git add -A
git commit -q -m "Filtres En ligne/En pause/Toutes par plateforme"
git push origin merge-master:main
git push origin merge-master:master
