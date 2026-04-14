import json
import subprocess
import os

triggers_dir = '.agents/triggers'
region = 'us-central1'
project = 'tavern-swiper-dev'

for filename in os.listdir(triggers_dir):
    if not filename.endswith('.json'):
        continue
    
    with open(os.path.join(triggers_dir, filename), 'r') as f:
        data = json.load(f)
        
    name = data['name']
    config_file = data['filename']
    branch = data.get('github', {}).get('push', {}).get('branch', 'main').replace('^', '').replace('$', '')
    substitutions = data.get('substitutions', {})
    sub_str = ','.join([f'{k}={v}' for k, v in substitutions.items()])
    
    cmd = [
        'gcloud', 'beta', 'builds', 'triggers', 'create', 'github',
        '--name', name,
        '--region', region,
        '--project', project,
        '--repo-name', 'tavern_swiper',
        '--repo-owner', 'pszaflarski',
        '--branch-pattern', branch,
        '--build-config', config_file,
        '--service-account', f'projects/{project}/serviceAccounts/cicd-builder@{project}.iam.gserviceaccount.com'
    ]
    
    if sub_str:
        cmd.extend(['--substitutions', sub_str])
        
    # Handle included files if present
    included_files = data.get('includedFiles')
    if included_files:
        cmd.extend(['--included-files', ','.join(included_files)])
        
    print(f"Recreating trigger {name} in {region}...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error recreating {name}: {result.stderr}")
    else:
        print(f"Successfully recreated {name}")
