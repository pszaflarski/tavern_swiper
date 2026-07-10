#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from google.cloud import firestore
from google.oauth2.credentials import Credentials

def get_gcloud_credentials():
    try:
        token = subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode("utf-8").strip()
        return Credentials(token)
    except Exception as e:
        print(f"⚠️ Warning: Could not fetch gcloud token: {e}")
        return None

def main():
    env = "dev"
    project_id = "tavern-swiper-dev"
    database_id = "characters-dev"

    print(f"🔍 Initializing Firestore client for project: {project_id}, database: {database_id}...")
    g_creds = get_gcloud_credentials()
    db = firestore.Client(project=project_id, database=database_id, credentials=g_creds)

    print("📋 Fetching tags...")
    tags_map = {}
    try:
        tag_docs = db.collection("character_tags").stream()
        for doc in tag_docs:
            data = doc.to_dict()
            slug = data.get("slug")
            if slug:
                tags_map[slug] = {
                    "name": data.get("name", ""),
                    "category": data.get("category", "")
                }
    except Exception as e:
        print(f"⚠️ Warning: Could not fetch tags: {e}")

    print("📋 Fetching images...")
    images_by_character = {}
    try:
        image_docs = db.collection("images").stream()
        for doc in image_docs:
            data = doc.to_dict()
            char_id = data.get("character_id")
            if char_id:
                img_data = {
                    "image_id": doc.id,
                    "url": data.get("url", ""),
                    "source_type": data.get("source_type", ""),
                    "position": data.get("position", 0)
                }
                if char_id not in images_by_character:
                    images_by_character[char_id] = []
                images_by_character[char_id].append(img_data)
        
        # Sort images by position
        for char_id in images_by_character:
            images_by_character[char_id].sort(key=lambda x: x["position"])
    except Exception as e:
        print(f"⚠️ Warning: Could not fetch images: {e}")

    print("📋 Fetching characters...")
    characters = []
    try:
        char_docs = db.collection("characters").stream()
        for doc in char_docs:
            data = doc.to_dict()
            char_id = doc.id
            status = data.get("status")
            
            # Determine status group
            is_legacy = False
            status_display = status
            if status is None or status == "":
                is_legacy = True
                status_display = "legacy"
            
            # Resolve tags
            resolved_tags = {"fandom": [], "race": [], "gender": [], "class": []}
            flat_tags = data.get("character_tags", [])
            for ht in flat_tags:
                # Splitting dot-notation like fandom__dd.race__orc
                parts = ht.split(".")
                for part in parts:
                    if part in tags_map:
                        t_info = tags_map[part]
                        cat = t_info["category"]
                        name = t_info["name"]
                        if cat in resolved_tags and name not in resolved_tags[cat]:
                            resolved_tags[cat].append(name)

            # Get images
            char_images = images_by_character.get(char_id, [])

            characters.append({
                "character_id": char_id,
                "display_name": data.get("display_name", "Unknown Character"),
                "tagline": data.get("tagline", ""),
                "bio": data.get("bio", ""),
                "status": status_display,
                "is_legacy": is_legacy,
                "tags": resolved_tags,
                "images": char_images,
                "created_at": data.get("created_at").isoformat() if data.get("created_at") else ""
            })
    except Exception as e:
        print(f"❌ Error fetching characters: {e}")
        sys.exit(1)

    print(f"✨ Found {len(characters)} characters total.")

    # Write HTML contents
    html_template = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tavern Swiper — Characters Dashboard</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;800&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-primary: #0f111a;
            --bg-secondary: #161925;
            --bg-tertiary: #1f2336;
            --border-color: #2e354f;
            --text-primary: #f3f4f6;
            --text-secondary: #9ca3af;
            --text-muted: #6b7280;
            --accent-gold: #d4af37;
            --accent-gold-hover: #f3cf58;
            --glow-gold: rgba(212, 175, 55, 0.2);
            
            --status-adopted-bg: rgba(16, 185, 129, 0.1);
            --status-adopted-text: #34d399;
            --status-adopted-border: rgba(16, 185, 129, 0.3);
            
            --status-pending-bg: rgba(245, 158, 11, 0.1);
            --status-pending-text: #fbbf24;
            --status-pending-border: rgba(245, 158, 11, 0.3);
            
            --status-legacy-bg: rgba(139, 92, 246, 0.1);
            --status-legacy-text: #a78bfa;
            --status-legacy-border: rgba(139, 92, 246, 0.3);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Outfit', sans-serif;
            background-color: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            padding: 2rem;
            line-height: 1.5;
        }

        header {
            max-width: 1400px;
            margin: 0 auto 2rem auto;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 1.5rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
        }

        .header-title h1 {
            font-family: 'Cinzel', serif;
            font-size: 2.2rem;
            font-weight: 800;
            color: var(--accent-gold);
            text-shadow: 0 0 10px var(--glow-gold);
            letter-spacing: 1px;
        }

        .header-title p {
            color: var(--text-secondary);
            font-size: 0.95rem;
            margin-top: 0.2rem;
        }

        .stats-container {
            display: flex;
            gap: 1.5rem;
        }

        .stat-card {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-color);
            padding: 0.75rem 1.25rem;
            border-radius: 8px;
            text-align: center;
            min-width: 100px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
        }

        .stat-value {
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--accent-gold);
        }

        .stat-label {
            font-size: 0.75rem;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 0.1rem;
        }

        .main-container {
            max-width: 1400px;
            margin: 0 auto;
        }

        .controls-bar {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-color);
            padding: 1rem;
            border-radius: 12px;
            margin-bottom: 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 1.5rem;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
        }

        .search-box {
            position: relative;
            flex: 1;
            min-width: 280px;
        }

        .search-box input {
            width: 100%;
            background-color: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            padding: 0.75rem 1rem 0.75rem 2.5rem;
            border-radius: 8px;
            font-family: inherit;
            font-size: 0.95rem;
            outline: none;
            transition: all 0.3s ease;
        }

        .search-box input:focus {
            border-color: var(--accent-gold);
            box-shadow: 0 0 8px var(--glow-gold);
        }

        .search-box::before {
            content: "🔍";
            position: absolute;
            left: 0.9rem;
            top: 50%;
            transform: translateY(-50%);
            font-size: 0.9rem;
            color: var(--text-muted);
        }

        .filter-tabs {
            display: flex;
            gap: 0.5rem;
            background-color: var(--bg-tertiary);
            padding: 0.25rem;
            border-radius: 8px;
            border: 1px solid var(--border-color);
        }

        .filter-tab {
            background: none;
            border: none;
            color: var(--text-secondary);
            padding: 0.5rem 1rem;
            border-radius: 6px;
            cursor: pointer;
            font-family: inherit;
            font-size: 0.9rem;
            font-weight: 500;
            transition: all 0.2s ease;
        }

        .filter-tab:hover {
            color: var(--text-primary);
        }

        .filter-tab.active {
            background-color: var(--bg-secondary);
            color: var(--accent-gold);
            border: 1px solid var(--border-color);
            box-shadow: 0 2px 4px rgba(0,0,0,0.15);
        }

        .view-toggles {
            display: flex;
            gap: 0.5rem;
        }

        .view-btn {
            background-color: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            color: var(--text-secondary);
            padding: 0.5rem 0.75rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9rem;
            transition: all 0.2s ease;
        }

        .view-btn:hover, .view-btn.active {
            color: var(--accent-gold);
            border-color: var(--accent-gold);
            background-color: var(--bg-secondary);
        }

        /* CARD VIEW LAYOUT */
        .cards-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
            gap: 1.5rem;
        }

        .char-card {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            box-shadow: 0 4px 10px rgba(0,0,0,0.25);
            transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), box-shadow 0.3s ease;
        }

        .char-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 8px 20px rgba(0,0,0,0.4);
            border-color: rgba(212, 175, 55, 0.4);
        }

        .char-image-container {
            position: relative;
            width: 100%;
            height: 240px;
            background-color: var(--bg-tertiary);
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .char-image-container img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 0.5s ease;
            cursor: zoom-in;
        }

        .char-image-container:hover img {
            transform: scale(1.05);
        }

        .no-image-placeholder {
            font-size: 3rem;
            opacity: 0.3;
        }

        .card-status-badge {
            position: absolute;
            top: 1rem;
            right: 1rem;
            padding: 0.3rem 0.75rem;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            backdrop-filter: blur(8px);
            box-shadow: 0 4px 6px rgba(0,0,0,0.2);
            border: 1px solid;
        }

        .badge-adopted {
            background-color: var(--status-adopted-bg);
            color: var(--status-adopted-text);
            border-color: var(--status-adopted-border);
        }

        .badge-pending {
            background-color: var(--status-pending-bg);
            color: var(--status-pending-text);
            border-color: var(--status-pending-border);
        }

        .badge-legacy {
            background-color: var(--status-legacy-bg);
            color: var(--status-legacy-text);
            border-color: var(--status-legacy-border);
        }

        .card-content {
            padding: 1.25rem;
            display: flex;
            flex-direction: column;
            flex: 1;
        }

        .char-name {
            font-family: 'Cinzel', serif;
            font-size: 1.3rem;
            font-weight: 700;
            color: var(--text-primary);
            margin-bottom: 0.3rem;
        }

        .char-tagline {
            font-style: italic;
            font-size: 0.88rem;
            color: var(--accent-gold);
            margin-bottom: 0.75rem;
            opacity: 0.9;
        }

        .char-bio {
            font-size: 0.9rem;
            color: var(--text-secondary);
            margin-bottom: 1.25rem;
            display: -webkit-box;
            -webkit-line-clamp: 4;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
            flex: 1;
        }

        .char-tags-row {
            display: flex;
            flex-wrap: wrap;
            gap: 0.4rem;
            margin-top: auto;
            padding-top: 1rem;
            border-top: 1px solid rgba(255,255,255,0.05);
        }

        .tag-badge {
            font-size: 0.72rem;
            padding: 0.15rem 0.5rem;
            border-radius: 4px;
            font-weight: 500;
            background-color: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            color: var(--text-secondary);
        }

        .tag-fandom { border-color: rgba(239, 68, 68, 0.3); color: #f87171; }
        .tag-race { border-color: rgba(59, 130, 246, 0.3); color: #60a5fa; }
        .tag-gender { border-color: rgba(16, 185, 129, 0.3); color: #34d399; }
        .tag-class { border-color: rgba(245, 158, 11, 0.3); color: #fbbf24; }

        /* TABLE VIEW LAYOUT */
        .table-container {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 15px rgba(0,0,0,0.25);
            display: none; /* toggled by JS */
        }

        table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
        }

        th {
            background-color: var(--bg-tertiary);
            padding: 1rem;
            font-size: 0.85rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-secondary);
            border-bottom: 1px solid var(--border-color);
        }

        td {
            padding: 1.25rem 1rem;
            border-bottom: 1px solid var(--border-color);
            vertical-align: top;
        }

        tr:last-child td {
            border-bottom: none;
        }

        tr:hover td {
            background-color: rgba(255,255,255,0.02);
        }

        .table-img-cell {
            width: 80px;
        }

        .table-thumb {
            width: 60px;
            height: 60px;
            border-radius: 6px;
            object-fit: cover;
            background-color: var(--bg-tertiary);
            cursor: zoom-in;
            border: 1px solid var(--border-color);
            transition: transform 0.2s ease;
        }

        .table-thumb:hover {
            transform: scale(1.1);
        }

        .table-char-title {
            font-family: 'Cinzel', serif;
            font-weight: 700;
            font-size: 1.1rem;
            color: var(--text-primary);
        }

        .table-char-tagline {
            font-style: italic;
            font-size: 0.82rem;
            color: var(--accent-gold);
            margin-top: 0.1rem;
        }

        .table-char-bio {
            font-size: 0.88rem;
            color: var(--text-secondary);
            max-width: 450px;
            line-height: 1.4;
        }

        .table-status-pill {
            display: inline-block;
            padding: 0.25rem 0.6rem;
            border-radius: 12px;
            font-size: 0.72rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border: 1px solid;
            text-align: center;
        }

        /* MODAL / LIGHTBOX */
        .lightbox {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(10, 11, 17, 0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s ease;
        }

        .lightbox.active {
            opacity: 1;
            pointer-events: auto;
        }

        .lightbox-content {
            position: relative;
            max-width: 90%;
            max-height: 90%;
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        .lightbox-img {
            max-width: 100%;
            max-height: 80vh;
            object-fit: contain;
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            border: 2px solid var(--border-color);
        }

        .lightbox-caption {
            margin-top: 1rem;
            font-family: 'Cinzel', serif;
            font-size: 1.3rem;
            color: var(--accent-gold);
            text-align: center;
        }

        .lightbox-close {
            position: absolute;
            top: -2.5rem;
            right: 0;
            background: none;
            border: none;
            color: var(--text-primary);
            font-size: 2rem;
            cursor: pointer;
            outline: none;
            transition: color 0.2s ease;
        }

        .lightbox-close:hover {
            color: var(--accent-gold);
        }

        /* EMPTY STATE */
        .empty-state {
            text-align: center;
            padding: 4rem 2rem;
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            color: var(--text-secondary);
        }

        .empty-state-icon {
            font-size: 3rem;
            margin-bottom: 1rem;
            opacity: 0.5;
        }

        /* RESPONSIVE DESIGN */
        @media (max-width: 768px) {
            body {
                padding: 1rem;
            }
            
            header {
                flex-direction: column;
                align-items: flex-start;
            }

            .stats-container {
                width: 100%;
                justify-content: space-between;
            }

            .controls-bar {
                flex-direction: column;
                align-items: stretch;
            }

            .search-box {
                width: 100%;
            }

            .filter-tabs {
                width: 100%;
                justify-content: space-around;
            }
        }
    </style>
</head>
<body>

    <header>
        <div class="header-title">
            <h1>Tavern Swiper</h1>
            <p>Character Catalog Explorer — Dev Environment</p>
        </div>
        <div class="stats-container">
            <div class="stat-card">
                <div class="stat-value" id="stat-total">0</div>
                <div class="stat-label">Total</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="stat-legacy" style="color: var(--status-legacy-text);">0</div>
                <div class="stat-label">Legacy</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="stat-adopted" style="color: var(--status-adopted-text);">0</div>
                <div class="stat-label">Adopted</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="stat-pending" style="color: var(--status-pending-text);">0</div>
                <div class="stat-label">Pending</div>
            </div>
        </div>
    </header>

    <div class="main-container">
        
        <div class="controls-bar">
            <div class="search-box">
                <input type="text" id="search-input" placeholder="Search by name, bio, tagline, tags...">
            </div>
            
            <div class="filter-tabs">
                <button class="filter-tab active" onclick="setFilter('all')">All</button>
                <button class="filter-tab" onclick="setFilter('legacy')">Legacy</button>
                <button class="filter-tab" onclick="setFilter('adopted')">Adopted</button>
                <button class="filter-tab" onclick="setFilter('pending')">Pending</button>
            </div>

            <div class="view-toggles">
                <button class="view-btn active" id="btn-grid" onclick="setViewMode('grid')">Grid View</button>
                <button class="view-btn" id="btn-table" onclick="setViewMode('table')">Table View</button>
            </div>
        </div>

        <!-- Cards View -->
        <div class="cards-grid" id="cards-view">
            <!-- Rendered by JS -->
        </div>

        <!-- Table View -->
        <div class="table-container" id="table-view">
            <table>
                <thead>
                    <tr>
                        <th class="table-img-cell">Image</th>
                        <th>Name & Tagline</th>
                        <th>Status</th>
                        <th>Bio</th>
                        <th>Tags</th>
                    </tr>
                </thead>
                <tbody id="table-body">
                    <!-- Rendered by JS -->
                </tbody>
            </table>
        </div>

        <!-- Empty State -->
        <div class="empty-state" id="empty-state" style="display: none;">
            <div class="empty-state-icon">🍺</div>
            <h2>No Characters Found</h2>
            <p>Try refining your search term or selecting another filter tab.</p>
        </div>

    </div>

    <!-- Lightbox Modal -->
    <div class="lightbox" id="lightbox" onclick="closeLightbox()">
        <div class="lightbox-content" onclick="event.stopPropagation()">
            <button class="lightbox-close" onclick="closeLightbox()">&times;</button>
            <img class="lightbox-img" id="lightbox-img" src="" alt="Full size character image">
            <div class="lightbox-caption" id="lightbox-caption"></div>
        </div>
    </div>

    <script>
        // Data injected from Python
        const characters = %CHARACTERS_JSON%;

        let currentFilter = 'all';
        let currentSearch = '';
        let viewMode = 'grid';

        // Initialize and compute stats
        function init() {
            let total = characters.length;
            let legacy = characters.filter(c => c.is_legacy).length;
            let adopted = characters.filter(c => c.status === 'adopted').length;
            let pending = characters.filter(c => c.status === 'pending').length;

            document.getElementById('stat-total').innerText = total;
            document.getElementById('stat-legacy').innerText = legacy;
            document.getElementById('stat-adopted').innerText = adopted;
            document.getElementById('stat-pending').innerText = pending;

            render();
            
            // Search Input listener
            document.getElementById('search-input').addEventListener('input', (e) => {
                currentSearch = e.target.value.toLowerCase().trim();
                render();
            });
        }

        // Filter and search logic
        function getFilteredCharacters() {
            return characters.filter(c => {
                // Filter Tab Match
                if (currentFilter === 'legacy' && !c.is_legacy) return false;
                if (currentFilter === 'adopted' && (c.status !== 'adopted' || c.is_legacy)) return false;
                if (currentFilter === 'pending' && c.status !== 'pending') return false;

                // Search Match
                if (currentSearch) {
                    const nameMatch = c.display_name.toLowerCase().includes(currentSearch);
                    const bioMatch = c.bio.toLowerCase().includes(currentSearch);
                    const taglineMatch = c.tagline.toLowerCase().includes(currentSearch);
                    
                    // Search tags
                    let tagMatch = false;
                    for (const cat in c.tags) {
                        if (c.tags[cat].some(t => t.toLowerCase().includes(currentSearch))) {
                            tagMatch = true;
                            break;
                        }
                    }

                    return nameMatch || bioMatch || taglineMatch || tagMatch;
                }

                return true;
            });
        }

        // Render main view
        function render() {
            const filtered = getFilteredCharacters();
            const cardsView = document.getElementById('cards-view');
            const tableView = document.getElementById('table-view');
            const emptyState = document.getElementById('empty-state');

            if (filtered.length === 0) {
                cardsView.style.display = 'none';
                tableView.style.display = 'none';
                emptyState.style.display = 'block';
                return;
            }

            emptyState.style.display = 'none';

            if (viewMode === 'grid') {
                cardsView.style.display = 'grid';
                tableView.style.display = 'none';
                renderGrid(filtered);
            } else {
                cardsView.style.display = 'none';
                tableView.style.display = 'block';
                renderTable(filtered);
            }
        }

        function getStatusBadgeClass(c) {
            if (c.is_legacy) return 'badge-legacy';
            if (c.status === 'adopted') return 'badge-adopted';
            return 'badge-pending';
        }

        function getStatusLabel(c) {
            if (c.is_legacy) return 'Legacy';
            return c.status;
        }

        function renderGrid(chars) {
            const grid = document.getElementById('cards-view');
            grid.innerHTML = chars.map(c => {
                const imgUrl = c.images && c.images.length > 0 ? c.images[0].url : '';
                const imgHtml = imgUrl 
                    ? `<img src="${imgUrl}" alt="${c.display_name}" onclick="openLightbox('${imgUrl}', '${escapeHtml(c.display_name)}')">`
                    : '<div class="no-image-placeholder">👤</div>';

                // Format tags
                let tagBadges = [];
                for (const cat in c.tags) {
                    c.tags[cat].forEach(t => {
                        tagBadges.push(`<span class="tag-badge tag-${cat}">${t}</span>`);
                    });
                }

                return `
                    <div class="char-card">
                        <div class="char-image-container">
                            ${imgHtml}
                            <span class="card-status-badge ${getStatusBadgeClass(c)}">${getStatusLabel(c)}</span>
                        </div>
                        <div class="card-content">
                            <h3 class="char-name">${escapeHtml(c.display_name)}</h3>
                            ${c.tagline ? `<p class="char-tagline">"${escapeHtml(c.tagline)}"</p>` : ''}
                            <p class="char-bio">${escapeHtml(c.bio)}</p>
                            <div class="char-tags-row">
                                ${tagBadges.join('')}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function renderTable(chars) {
            const body = document.getElementById('table-body');
            body.innerHTML = chars.map(c => {
                const imgUrl = c.images && c.images.length > 0 ? c.images[0].url : '';
                const imgHtml = imgUrl 
                    ? `<img src="${imgUrl}" alt="${c.display_name}" class="table-thumb" onclick="openLightbox('${imgUrl}', '${escapeHtml(c.display_name)}')">`
                    : '<div style="font-size: 1.5rem; text-align: center;">👤</div>';

                // Format tags
                let tagBadges = [];
                for (const cat in c.tags) {
                    c.tags[cat].forEach(t => {
                        tagBadges.push(`<span class="tag-badge tag-${cat}">${t}</span>`);
                    });
                }

                return `
                    <tr>
                        <td class="table-img-cell">${imgHtml}</td>
                        <td>
                            <div class="table-char-title">${escapeHtml(c.display_name)}</div>
                            ${c.tagline ? `<div class="table-char-tagline">"${escapeHtml(c.tagline)}"</div>` : ''}
                        </td>
                        <td>
                            <span class="table-status-pill ${getStatusBadgeClass(c)}">${getStatusLabel(c)}</span>
                        </td>
                        <td><div class="table-char-bio">${escapeHtml(c.bio)}</div></td>
                        <td>
                            <div style="display: flex; flex-wrap: wrap; gap: 0.3rem; max-width: 250px;">
                                ${tagBadges.join('')}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        function setFilter(filter) {
            currentFilter = filter;
            
            // Update active class
            document.querySelectorAll('.filter-tab').forEach(tab => {
                tab.classList.remove('active');
            });
            event.target.classList.add('active');
            
            render();
        }

        function setViewMode(mode) {
            viewMode = mode;
            document.getElementById('btn-grid').classList.toggle('active', mode === 'grid');
            document.getElementById('btn-table').classList.toggle('active', mode === 'table');
            render();
        }

        function openLightbox(url, name) {
            const lightbox = document.getElementById('lightbox');
            document.getElementById('lightbox-img').src = url;
            document.getElementById('lightbox-caption').innerText = name;
            lightbox.classList.add('active');
        }

        function closeLightbox() {
            document.getElementById('lightbox').classList.remove('active');
        }

        function escapeHtml(str) {
            if (!str) return '';
            return str
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        // Close lightbox on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeLightbox();
        });

        // Initialize app on load
        window.addEventListener('DOMContentLoaded', init);
    </script>
</body>
</html>
"""

    # Inject characters JSON
    html_output = html_template.replace("%CHARACTERS_JSON%", json.dumps(characters, indent=2))

    output_path = "/home/peter/Documents/tavern_swiper/scripts/characters_dev_dashboard.html"
    print(f"💾 Writing dashboard to: {output_path}...")
    try:
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(html_output)
        print("🎉 Successfully generated dashboard!")
    except Exception as e:
        print(f"❌ Error writing HTML file: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
