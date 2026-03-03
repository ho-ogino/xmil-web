#if 0

#define	FDDMTR_INIT			;
#define	FDDMTR_BUSY			0
#define	FDDMTR_MOVE			;
#define	FDDMTR_WAITSEC(v)	;
#define	FDDMTR_CALLBACK(t)	;
#define	FDDMTR_DRVSET		;

#else

extern	void	fddmtr_init(void);
extern	BYTE	curevent;
extern	void	fddmtr_motormove(void);
extern	void	fddmtr_callback(DWORD time);
extern	void	fddmtr_waitsec(BYTE value);
extern	void	fddmtr_drvset(void);

#define	FDDMTR_INIT			fddmtr_init()
#define	FDDMTR_BUSY 		curevent
#define	FDDMTR_MOVE 		fddmtr_motormove()
#define	FDDMTR_WAITSEC(t)	fddmtr_waitsec(t)
#define	FDDMTR_CALLBACK(t)	fddmtr_callback(t)
#define	FDDMTR_DRVSET		fddmtr_drvset()
#endif

extern	BYTE	motordisable;

