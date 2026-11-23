$env:Path += ';C:\Program Files\Git\cmd'
$key = Join-Path $env:USERPROFILE '.ssh\fluxlibre_deploy_key'
$env:GIT_SSH_COMMAND = '"C:\Program Files\Git\usr\bin\ssh.exe" -i "' + $key + '" -o StrictHostKeyChecking=accept-new'
git add -A
git commit -q -m "Ajout GitHub Actions: build extension et backend + releases"
git push origin main
git push origin merge-master:master
