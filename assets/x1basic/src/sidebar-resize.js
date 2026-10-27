'use strict';
window.X1SidebarResize = function(onResize) {
  const sidebar=document.getElementById('sidebar'), handle=document.getElementById('sidebar-resizer');
  const main=sidebar.parentElement;
  let manualWidth=null, drag=null;
  function bounds(){
    const max=Math.max(0,Math.floor(main.getBoundingClientRect().width-handle.getBoundingClientRect().width-160));
    return {min:Math.min(220,max),max};
  }
  function refresh(){
    const {min,max}=bounds();
    if(manualWidth!==null){
      const applied=Math.max(min,Math.min(max,manualWidth));
      sidebar.style.setProperty('--sidebar-width',applied+'px');
    }
    handle.setAttribute('aria-valuemin',String(min));
    handle.setAttribute('aria-valuemax',String(max));
    handle.setAttribute('aria-valuenow',String(Math.round(sidebar.getBoundingClientRect().width)));
    onResize();
  }
  function setWidth(width){manualWidth=width;refresh();}
  function finish(event){
    if(!drag || (event?.pointerId!==undefined && event.pointerId!==drag.id))return;
    const id=drag.id;drag=null;
    document.body.classList.remove('resizing-sidebar');
    if(handle.hasPointerCapture(id))handle.releasePointerCapture(id);
  }
  handle.addEventListener('pointerdown',event=>{
    if(event.button!==0 || !event.isPrimary || drag)return;
    event.preventDefault();handle.focus();
    handle.setPointerCapture(event.pointerId);
    drag={id:event.pointerId,x:event.clientX,width:sidebar.getBoundingClientRect().width};
    document.body.classList.add('resizing-sidebar');
  });
  handle.addEventListener('pointermove',event=>{
    if(drag && event.pointerId===drag.id)setWidth(drag.width+drag.x-event.clientX);
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(name,finish);
  window.addEventListener('blur',()=>finish());
  handle.addEventListener('keydown',event=>{
    if(event.key==='Home'){
      event.preventDefault();manualWidth=null;sidebar.style.removeProperty('--sidebar-width');refresh();
    }else if(event.key==='ArrowLeft' || event.key==='ArrowRight'){
      event.preventDefault();setWidth(sidebar.getBoundingClientRect().width+(event.key==='ArrowLeft'?10:-10));
    }
  });
  window.addEventListener('resize',refresh);
  if(window.ResizeObserver){
    const observer=new ResizeObserver(refresh);observer.observe(main);observer.observe(sidebar);
  }
  refresh();
  return {refresh};
};
