declare module 'virtual:reviewed-shortlist' {
  const review: {reviewedOn:string;roles:string;location:string;minSalary:string;onWorkVisa:boolean;jobs:{title:string;company:string;location:string;salary:string;salaryMin:number;salaryMax:number;url:string;date:string|null;fit:string;gap:string;note?:string;salarySource?:string}[]}|null;
  export default review;
}
