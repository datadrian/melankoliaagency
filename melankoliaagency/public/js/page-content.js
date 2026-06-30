/* Melankolia public page content hydration v1 */
(function(){
  const DEFAULTS = {
    about: {
      title:'About Melankolia Agency',
      topText:`As specialists in artist management, we champion the enigmatic sounds of Dark Wave, Post-Punk, EBM, Dark Electro, Shoegaze, Industrial and Dark Techno. Our passion extends beyond borders; we're adept at bringing groundbreaking acts to the international stages, creating a cultural exchange that enriches the dark scene. Alongside artist management, we excel in dynamic promotion and enthralling content creation. From the introspective depths of shoegaze to the pulsating energy of dark techno, we're the architects of aural and visual experiences that captivate audiences globally.`,
      bottomText:`At Melankolia Agency, we believe in the transformative power of art and emotion. Our journey began with a profound appreciation for the depth and beauty of melancholia, a concept deeply rooted in our Finnish origins and reflected in our name.\n\nOur story starts with Anna-Maria, the founder who grew up in Finland but found her footing in the dynamic music scene of Berlin. Her expertise in marketing and a personal passion for music and booking artists led her to a pivotal realization: her true calling was in connecting extraordinary talent with audiences craving profound experiences.\n\nAs our agency grew, we welcomed Adrian, a Los Angeles-based creative with a rich background in TV and film. His addition broadened our perspective, enabling us to evolve into more than a booking agency – we became a global sanctuary for creative expression.\n\nToday, Melankolia Agency stands as a beacon of artistic collaboration, extending our reach across Europe, the U.S. and Latin America with a team of four. We offer a diverse range of services, including video production, marketing, tour management, and styling, all designed to curate experiences that resonate at a soulful level.\n\nJoin us on a journey where each note, beat, and frame contributes to a story worth cherishing. Melankolia Agency is more than a connector of talent; it's a celebration of the arts, a curator of emotions, and a guardian of the nuanced beauty found within melancholy.`,
      instagram:'https://www.instagram.com/melankoliaagency/', facebook:'https://www.facebook.com/melankoliaagency/'
    },
    submission: {
      title:'Artist Submission',
      subtitle:`At Melankolia Agency, we're constantly on the lookout for artists and creators. If you resonate with the haunting melodies of Dark Wave, the raw energy of Post-Punk, the rhythmic pulse of EBM or Industrial, the electric vibes of Dark Electro, the immersive beats of Dark Techno or ethereal soundscapes of Shoegaze, Dream Pop or beyond we're looking for you.`,
      offerTitle:'What We Offer',
      offerText:'Expert artist management and booking, with a specialty in introducing U.S. acts to the vibrant European scene.\nInnovative promotion strategies to elevate your presence in the music world.\nCreative content creation, including visually stunning music videos and engaging social media content.',
      reachTitle:'Who Should Reach Out',
      reachText:'Bands and solo artists in the genre seeking management and booking.\nMusic creators looking for dynamic promotion and marketing.\nVisionaries desiring to collaborate on unique content creation projects.',
      contactText:`If you're passionate about making your mark in the dark and eager to expand your reach across continents, Melankolia Agency is your ally. Let's create something extraordinary together.`,
      formTitle:'Submit Your Material', formIntro:`Share your music, your vision, and your story with us. Send us an email at booking@MelankoliaAgency.com. Attach links to your music, a brief bio, and any relevant press materials. We're excited to hear from you and explore the potential of a thrilling collaboration.`
    }
  };
  const pageId = document.body?.dataset?.pageId;
  if (!pageId) return;
  const esc = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paras = text => String(text||'').split(/\n\s*\n/).map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('');
  const list = text => String(text||'').split('\n').map(x=>x.trim()).filter(Boolean).map(x=>`<li>${esc(x)}</li>`).join('');
  function apply(page){
    const p = {...(DEFAULTS[pageId]||{}), ...(page||{})};
    document.querySelectorAll('[data-page-field]').forEach(el=>{
      const field=el.dataset.pageField, format=el.dataset.pageFormat || 'text';
      const val=p[field]||'';
      if(format==='paragraphs') el.innerHTML=paras(val);
      else if(format==='list') el.innerHTML=list(val);
      else if(format==='href') el.href=val;
      else el.textContent=val;
    });
  }
  apply(DEFAULTS[pageId]);
  fetch('/.netlify/functions/site-data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'getPages'})})
    .then(r=>r.json()).then(j=>{ const pages=j?.data?.pages||{}; if(pages[pageId]) apply(pages[pageId]); }).catch(()=>{});
})();
