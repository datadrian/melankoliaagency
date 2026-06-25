import requests
from bs4 import BeautifulSoup
import json
import os
import re
import time
from urllib.parse import urljoin, urlparse

BASE_URL = "https://www.melankoliaagency.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
}

ARTISTS = [
    "automelodi", "bestial-mouths", "blood-handsome", "blood-rave",
    "bootblacks", "creux-lies", "cd-ghost", "corbeau-hangs",
    "dame-area", "daniel-myer", "die-sexual", "donzii",
    "jorge-elbrecht", "light-asylum", "male-tears", "mellow-code",
    "nox-novacula", "sacred-skin", "secret-attraction", "sleek-teeth",
    "some-ember", "street-fever", "topographies", "xtr-human",
    "yama-uba", "zanias"
]

def scrape_page(url):
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        return BeautifulSoup(r.text, 'html.parser')
    except Exception as e:
        print(f"  ERROR fetching {url}: {e}")
        return None

def download_image(url, dest_path):
    try:
        r = requests.get(url, headers=HEADERS, timeout=20, stream=True)
        if r.status_code == 200:
            with open(dest_path, 'wb') as f:
                for chunk in r.iter_content(8192):
                    f.write(chunk)
            return True
    except Exception as e:
        print(f"  IMG ERROR {url}: {e}")
    return False

def get_page_images(soup, base_url):
    imgs = []
    for tag in soup.find_all('img'):
        src = tag.get('src') or tag.get('data-src') or ''
        if src and not src.startswith('data:'):
            full = urljoin(base_url, src)
            imgs.append(full)
    return imgs

def get_links(soup, label):
    links = {}
    for a in soup.find_all('a', href=True):
        text = a.get_text(strip=True).lower()
        href = a['href']
        if text in ['website', 'instagram', 'facebook', 'bandcamp', 'spotify', 
                    'soundcloud', 'twitter', 'youtube', 'tiktok']:
            links[text] = href
    return links

results = {}

# ---- Scrape homepage ----
print("Scraping homepage...")
home = scrape_page(BASE_URL)
if home:
    home_images = get_page_images(home, BASE_URL)
    results['homepage'] = {'images': home_images}
    print(f"  Found {len(home_images)} images on homepage")

# ---- Scrape Booking page ----
print("\nScraping booking page...")
booking = scrape_page(f"{BASE_URL}/booking")
if booking:
    content = booking.get_text(separator='\n', strip=True)
    results['booking'] = {'text': content}
    print("  Booking page scraped")

# ---- Scrape Submission page ----
print("\nScraping submission page...")
sub = scrape_page(f"{BASE_URL}/submission")
if sub:
    # Get the main content div
    main = sub.find('main') or sub.find('div', {'role': 'main'}) or sub.body
    content = main.get_text(separator='\n', strip=True) if main else sub.get_text(separator='\n', strip=True)
    results['submission'] = {'text': content}
    print("  Submission page scraped")

# ---- Scrape each artist ----
print("\nScraping artist pages...")
artist_data = {}

for slug in ARTISTS:
    url = f"{BASE_URL}/{slug}"
    print(f"  Scraping {slug}...")
    soup = scrape_page(url)
    if not soup:
        # Try with different URL patterns
        url2 = f"{BASE_URL}/{slug.replace('-', '')}"
        soup = scrape_page(url2)
        if not soup:
            print(f"    Could not fetch {slug}")
            artist_data[slug] = {"error": "not found"}
            continue
    
    # Get bio text
    main = soup.find('main') or soup.find('div', {'role': 'main'}) or soup.body
    bio_text = ""
    if main:
        # Remove nav and footer noise
        for tag in main.find_all(['nav', 'footer', 'header']):
            tag.decompose()
        bio_text = main.get_text(separator='\n', strip=True)
    
    # Get social links
    social_links = get_links(soup, slug)
    
    # Get all image URLs
    images = get_page_images(soup, url)
    
    # Also check homepage grid for thumbnail
    artist_name = slug.replace('-', ' ').title()
    
    artist_data[slug] = {
        "name": artist_name,
        "slug": slug,
        "bio": bio_text,
        "social_links": social_links,
        "images": images
    }
    
    print(f"    Bio: {len(bio_text)} chars, Links: {list(social_links.keys())}, Images: {len(images)}")
    time.sleep(0.5)  # be polite

results['artists'] = artist_data

# Save results
with open('/app/melankolia_scrape/scraped_data.json', 'w') as f:
    json.dump(results, f, indent=2)

print(f"\n✅ Scrape complete! Saved to scraped_data.json")
print(f"Artists scraped: {len(artist_data)}")
