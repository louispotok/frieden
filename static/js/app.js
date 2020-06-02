const {
    Component,
} = window.Torus;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TZOFFSET = new Date().getTimezoneOffset() * MINUTE;

const HOUR_HEIGHT = 50; // px
const timeToPx = t => t / HOUR * HOUR_HEIGHT;

const DAYS_OF_WEEK = [
    'Sun',
    'Mon',
    'Tue',
    'Wed',
    'Thu',
    'Fri',
    'Sat',
];

//> Shorthand for JS timestamp
const ut = () => +(new Date());

//> Round date to the top of the day
const dfloor = t => {
    const ut = t - TZOFFSET;
    const rounded = ut - ut % DAY;
    return rounded + TZOFFSET;
}

//> UNIX timestamp -> ISO Date string
const dfmt = t => new Date(t).toISOString();

//> Filter slots to find ones in a date range
const dfilterSlots = (start, end, slots) => slots.filter(s => {
    return start < s.end && end > s.start;
});

//> Humanize date format
const dhuman = t => {
    const dt = new Date(t);
    const year = dt.getFullYear();
    const month = dt.getMonth() + 1;
    const date = dt.getDate();
    if (year === new Date().getFullYear()) {
        return `${month}/${date}`;
    }

    return `${year}/${month}/${date}`;
}

//> Humanize time format
const thuman = t => {
    const dt = new Date(t);
    const hh = dt.getHours() % 12 || 12;
    const mm = dt.getMinutes().toString().padStart(2, '0');
    const ampm = (t - TZOFFSET) % DAY < DAY / 2 ? 'AM' : 'PM';

    if (mm === '00') {
        return `${hh}\xa0${ampm}`;
    }

    return `${hh}:${mm}\xa0${ampm}`;
}

//> Debounce coalesces multiple calls to the same function in a short
//  period of time into one call, by cancelling subsequent calls within
//  a given timeframe.
const debounce = (fn, delayMillis) => {
    let lastRun = 0;
    let to = null;
    return (...args) => {
        clearTimeout(to);
        const now = Date.now();
        const dfn = () => {
            lastRun = now;
            fn(...args);
        }
        if (now - lastRun > delayMillis) {
            dfn()
        } else {
            to = setTimeout(dfn, delayMillis);
        }
    }
}

async function getBusySlots(start, days) {
    const end = start + days * DAY;
    const data = await fetch('/data', {
        method: 'POST',
        body: JSON.stringify({
            timeMin: dfmt(start),
            timeMax: dfmt(end),
        })
    }).then(resp => resp.json());
    const calendars = Object.values(data.calendars);
    const slots = [];
    for (const cal of calendars) {
        for (const slot of cal.busy) {
            slots.push({
                start: +new Date(slot.start),
                end: +new Date(slot.end),
            });
        }
    }
    return slots;
}

function Slot(slot, t) {
    const startHour = (slot.start - TZOFFSET) % DAY;
    const daysPrevious = (dfloor(slot.start) - t) / DAY;
    const duration = slot.end - slot.start;
    return jdom`<div class="slot"
        style="top:${timeToPx(startHour)
            + timeToPx(daysPrevious * DAY)
            + HOUR_HEIGHT}px;height:${timeToPx(duration)}px">
        ${thuman(slot.start)} - ${thuman(slot.end)}
    </div>`;
}

function Hour(hour) {
    if (hour === 0) {
        return jdom`<div class="hour"></div>`;
    }

    const hh = hour % 12 || 12;
    let ampm = hour / 12 > 1 ? 'PM' : 'AM';
    if (hh === 12) {
        ampm = ampm === 'AM' ? 'PM ' : 'AM';
    }
    return jdom`<div class="hour">
        <div class="hourAnnotation">
            ${hh} ${ampm}
        </div>
    </div>`;
}

function Day(t, slots, daysPerScreen) {
    const isToday = t === dfloor(ut());
    const nowBar = jdom`<div class="now"
        style="top:${timeToPx((ut() - TZOFFSET) % DAY + HOUR_HEIGHT)}px">
        now
    </div>`;

    const hours = [];
    for (let i = 0; i < 24; i ++) {
        hours.push(Hour(i));
    }

    const slotViews = [];
    for (const slot of dfilterSlots(t, t + DAY, slots)) {
        slotViews.push(Slot(slot, t));
    }

    return jdom`<div class="day" style="width:${100/daysPerScreen}%">
        <div class="dateLabel ${isToday ? 'accent' : ''}" style="width:${100/daysPerScreen}%">
            <h2>${DAYS_OF_WEEK[new Date(t).getDay()]}</h2>
            <p>${dhuman(t)}</p>
        </div>
        <div class="dateBox">
            ${hours}
            ${slotViews}
            ${isToday ? nowBar : null}
        </div>
    </div>`;
}

class App extends Component {

    init() {
        this._firstScrolled = false;
        this.lastFetchedDay = 0;
        this.lastFetchedDaysPerScreen = 0;

        this.day = dfloor(ut());
        this.daysPerScreen = 3;
        this.slots = [];

        this.handleToday = this.adjustToday.bind(this);
        this.handleLeftDay = this.adjustDate.bind(this, -1);
        this.handleRightDay = this.adjustDate.bind(this, 1);
        this.handleLeftWeek = this.adjustDate.bind(this, -7);
        this.handleRightWeek = this.adjustDate.bind(this, 7);
        this.resize = debounce(this.resize.bind(this), 600);
        this.fetch = debounce(this.fetch.bind(this), 600);

        window.addEventListener('resize', this.resize);

        this.resize();
    }

    remove() {
        this.super.remove();
        window.removeEventListener('resize', this.resize);
    }

    resize() {
        const w = window.innerWidth;
        const count = ~~(w / 150);

        if (count <= 3) {
            this.daysPerScreen = 3;
        } else if (count == 4) {
            this.daysPerScreen = 4;
        } else if (count == 5) {
            this.daysPerScreen = 5;
        } else if (count == 6) {
            this.daysPerScreen = 6;
        } else {
            this.daysPerScreen = 7;
        }

        //> We render once before fetching b/c fetch's render trigger
        //  may come after a network elay
        this.render();
        this.fetch();
    }

    async fetch() {
        if (this.lastFetchedDay === this.day && this.lastFetchedDaysPerScreen === this.daysPerScreen) {
            return
        }

        this.lastFetchedDay = this.day;
        this.lastFetchedDaysPerScreen = this.daysPerScreen;

        this.slots = await getBusySlots(this.day, this.daysPerScreen);
        this.render();

        //> Scroll to 8AM after first fetch
        if (!this._firstScrolled) {
            this._firstScrolled = true;
            this.node.querySelector('.days').scrollTop = 8 * HOUR_HEIGHT;
        }
    }

    adjustDate(daysOffset) {
        this.day += daysOffset * DAY;

        //> We render once before fetching b/c fetch's render trigger
        //  may come after a network elay
        this.render();

        this.fetch();
    }

    adjustToday() {
        this.day = dfloor(ut());
        this.fetch();
    }

    compose() {
        const days = [];
        for (let i = 0; i < this.daysPerScreen; i ++) {
            days.push(Day(this.day + i * DAY, this.slots, this.daysPerScreen));
        }

        return jdom`<div class="app">
            <header>
                <h1>
                    <div>When is Linus free?</div>
                    <button class="setDateButton block">pick date</button>
                </h1>
                <nav>
                    <button class="block leftWeekButton"
                        onclick="${this.handleLeftWeek}">${'<<'} w</button>
                    <button class="block leftDayButton"
                        onclick="${this.handleLeftDay}">${'<'} d</button>
                    <button class="accent block todayButton"
                        onclick="${this.handleToday}">today</button>
                    <button class="block rightDayButton"
                        onclick="${this.handleRightDay}">d ${'>'}</button>
                    <button class="block rightWeekButton"
                        onclick="${this.handleRightWeek}">w ${'>>'}</button>
                </nav>
            </header>
            <div class="daysBox fixed block">
                <div class="days">
                    ${days}
                </div>
            </div>
        </div>`;
    }
}

const app = new App();
document.getElementById('root').appendChild(app.node);