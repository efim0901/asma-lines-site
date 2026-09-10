const rates={base:85,perKm:1.65,perTonne:18,fragile:1.12,temperature:1.28,loading:45};
document.querySelectorAll('[data-year]').forEach((node)=>node.textContent=new Date().getFullYear());
const menu=document.querySelector('.menu-toggle'),nav=document.querySelector('nav');
if(menu)menu.addEventListener('click',()=>{const open=nav.classList.toggle('open');menu.setAttribute('aria-expanded',open);});
const calculator=document.querySelector('#calculator');
if(calculator)calculator.addEventListener('submit',(event)=>{event.preventDefault();const data=new FormData(calculator),km=Number(data.get('distance')),weight=Number(data.get('weight'));let total=rates.base+km*rates.perKm+weight*rates.perTonne;if(data.get('cargo')==='fragile')total*=rates.fragile;if(data.get('cargo')==='temperature')total*=rates.temperature;if(data.get('loading'))total+=rates.loading;document.querySelector('.quote-label').textContent=`${data.get('from')} → ${data.get('to')}`;document.querySelector('#quote-total').textContent=`от ${Math.round(total).toLocaleString('ru-RU')} BYN`;document.querySelector('#quote-note').textContent='Ориентировочная стоимость. Итоговая ставка зависит от даты, типа транспорта и условий перевозки.';document.querySelector('#quote-link').classList.remove('hidden');});
const contact=document.querySelector('[data-contact-form]');
if(contact)contact.addEventListener('submit',(event)=>{event.preventDefault();contact.querySelector('.form-status').textContent='Форма готова к подключению к серверной отправке. Пока укажите рабочий e-mail или CRM-интеграцию.';});
