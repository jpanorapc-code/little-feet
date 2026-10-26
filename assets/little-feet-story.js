(function () {
 'use strict';
 const pages=[
  {leftTitle:'A penguin with a big idea',leftText:'At the top of the world, villages sat far apart. One little penguin dreamed of bringing them together.',rightTitle:'He kept building',rightText:'He made one invention after another. They wobbled, sputtered, and sometimes fell apart.'},
  {leftTitle:'The laughter hurt',leftText:'When his projects failed, everyone laughed at him. For a while, the workshop felt very quiet.',rightTitle:'Still, he tried again',rightText:'Each mistake taught him something new. He would not give up on the villages—or his idea.'},
  {leftTitle:'A better idea took shape',leftText:'He joined what he had learned into one simple plan: help every village share what it needed.',rightTitle:'Little Feet was born',rightText:'At last, his invention worked. Little Feet began connecting the villages across the North Pole.'},
  {leftTitle:'The villages were connected',leftText:'Messages, learning, plans, and helping hands could travel between places that once felt far away.',rightTitle:'Small steps. Big things.',rightText:'The penguin’s little idea became a platform built to bring school communities together.'}
 ];
 function init(){
  const book=document.querySelector('#portalTour .lf-storybook'),spread=book?.querySelector('.lf-story-spread');
  const leftTitle=book?.querySelector('.lf-story-page-left .lf-story-heading'),leftText=book?.querySelector('.lf-story-page-left .lf-story-copy');
  const rightTitle=book?.querySelector('.lf-story-page-right .lf-story-heading'),rightText=book?.querySelector('.lf-story-page-right .lf-story-copy');
  const count=book?.querySelector('.lf-story-page-count'),back=book?.querySelector('.lf-story-arrow-left'),next=book?.querySelector('.lf-story-arrow-right');
  if(!book||!spread||!leftTitle||!leftText||!rightTitle||!rightText||!count||!back||!next)return;
  let pageIndex=0;
  const render=direction=>{
   const page=pages[pageIndex];spread.classList.remove('is-turning');void spread.offsetWidth;spread.classList.add('is-turning');
   leftTitle.textContent=page.leftTitle;leftText.textContent=page.leftText;rightTitle.textContent=page.rightTitle;rightText.textContent=page.rightText;
   count.textContent='Page '+(pageIndex+1)+' of '+pages.length;book.dataset.page=String(pageIndex+1);back.disabled=pageIndex===0;next.disabled=pageIndex===pages.length-1;spread.dataset.direction=direction;
  };
  back.addEventListener('click',()=>{if(pageIndex>0){pageIndex--;render('back');}});
  next.addEventListener('click',()=>{if(pageIndex<pages.length-1){pageIndex++;render('forward');}});
  book.addEventListener('keydown',event=>{
   if(event.key==='ArrowLeft'&&pageIndex>0){pageIndex--;render('back');back.focus();}
   if(event.key==='ArrowRight'&&pageIndex<pages.length-1){pageIndex++;render('forward');next.focus();}
  });
  render('forward');
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();