const rates={base:85,perKm:1.65,perTonne:18,fragile:1.12,temperature:1.28,loading:45};
const header=document.querySelector('.site-header');
if(header){
  header.insertAdjacentHTML('beforebegin','<div class="top-line"><div class="top-line-inner"><span><strong>ASMA LINES</strong> · Внутренние перевозки по Беларуси</span><span>Гомель · Беларусь</span></div></div>');
  if(!header.querySelector('a[href="faq.html"]'))header.querySelector('nav').insertAdjacentHTML('beforeend','<a href="faq.html">FAQ</a>');
  header.querySelector('.menu-toggle').insertAdjacentHTML('beforebegin','<button class="theme-toggle" type="button" aria-label="Переключить цветовую тему" title="Переключить тему">◐</button>');
  document.body.insertAdjacentHTML('beforeend','<a class="floating-contact" href="contacts.html" aria-label="Перейти к контактам">↗</a>');
}
const themeButton=document.querySelector('.theme-toggle');
const savedTheme=localStorage.getItem('asma-theme');
if(savedTheme==='dark')document.body.dataset.theme='dark';
if(themeButton)themeButton.addEventListener('click',()=>{const dark=document.body.dataset.theme==='dark';document.body.dataset.theme=dark?'':'dark';localStorage.setItem('asma-theme',dark?'light':'dark');});
document.querySelectorAll('[data-year]').forEach((node)=>node.textContent=new Date().getFullYear());
const menu=document.querySelector('.menu-toggle'),nav=document.querySelector('nav');
if(menu)menu.addEventListener('click',()=>{const open=nav.classList.toggle('open');menu.setAttribute('aria-expanded',open);});
const calculator=document.querySelector('#calculator');
if(calculator)calculator.addEventListener('submit',(event)=>{event.preventDefault();const data=new FormData(calculator),km=Number(data.get('distance')),weight=Number(data.get('weight'));let total=rates.base+km*rates.perKm+weight*rates.perTonne;if(data.get('cargo')==='fragile')total*=rates.fragile;if(data.get('cargo')==='temperature')total*=rates.temperature;if(data.get('loading'))total+=rates.loading;document.querySelector('.quote-label').textContent=`${data.get('from')} → ${data.get('to')}`;document.querySelector('#quote-total').textContent=`от ${Math.round(total).toLocaleString('ru-RU')} BYN`;document.querySelector('#quote-note').textContent='Ориентировочная стоимость. Итоговая ставка зависит от даты, типа транспорта и условий перевозки.';document.querySelector('#quote-link').classList.remove('hidden');});
const contact=document.querySelector('[data-contact-form]');
if(contact)contact.addEventListener('submit',(event)=>{event.preventDefault();contact.querySelector('.form-status').textContent='Форма готова к подключению к серверной отправке. Пока укажите рабочий e-mail или CRM-интеграцию.';});
